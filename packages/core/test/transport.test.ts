import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyResponse,
  makeFetchTransport,
  maybeCompress,
  type TransportRequest,
} from '../src/transport.js';

const headers = (values: Record<string, string>) => (name: string) => values[name] ?? null;
const request: TransportRequest = {
  url: 'https://beacon.test/api/1/envelope/',
  headers: {},
  body: 'x',
  category: 'error',
};
const gzip = (body: string) => Promise.resolve(new Uint8Array(gzipSync(body)));

describe('classifyResponse', () => {
  it('maps statuses', () => {
    expect(classifyResponse(200, headers({}), 0)).toEqual({ kind: 'ok' });
    expect(classifyResponse(204, headers({}), 0)).toEqual({ kind: 'ok' });
    expect(classifyResponse(400, headers({}), 0)).toEqual({
      kind: 'drop',
      reason: 'invalid',
      status: 400,
    });
    expect(classifyResponse(401, headers({}), 0)).toEqual({
      kind: 'drop',
      reason: 'unauthorized',
      status: 401,
    });
    expect(classifyResponse(403, headers({}), 0)).toEqual({
      kind: 'drop',
      reason: 'forbidden',
      status: 403,
    });
    expect(classifyResponse(413, headers({}), 0)).toEqual({
      kind: 'drop',
      reason: 'too_large',
      status: 413,
    });
    expect(classifyResponse(404, headers({}), 0)).toEqual({
      kind: 'drop',
      reason: 'client',
      status: 404,
    });
    expect(classifyResponse(302, headers({}), 0)).toEqual({
      kind: 'drop',
      reason: 'client',
      status: 302,
    });
  });

  it('handles 429 with Retry-After, rate-limit reasons and quota', () => {
    expect(
      classifyResponse(429, headers({ 'retry-after': '7', 'x-beacon-rate-limit': 'ip' }), 0),
    ).toEqual({ kind: 'retry', afterMs: 7000, reason: 'ratelimit', rateLimit: 'ip', status: 429 });
    expect(classifyResponse(429, headers({}), 0)).toEqual({
      kind: 'retry',
      afterMs: 60000,
      reason: 'ratelimit',
      status: 429,
    });
    expect(classifyResponse(429, headers({ 'retry-after': 'bogus' }), 0)).toMatchObject({
      afterMs: 60000,
    });
    expect(
      classifyResponse(429, headers({ 'retry-after': '60', 'x-beacon-rate-limit': 'quota' }), 0),
    ).toEqual({
      kind: 'retry',
      afterMs: 3600000,
      reason: 'quota',
      rateLimit: 'quota',
      status: 429,
    });
    expect(
      classifyResponse(
        429,
        headers({ 'retry-after': '5', 'x-sentry-rate-limits': '30:error:key' }),
        0,
      ),
    ).toMatchObject({ afterMs: 30000 });
  });

  it('retries 5xx', () => {
    expect(classifyResponse(503, headers({ 'retry-after': '3' }), 0)).toEqual({
      kind: 'retry',
      afterMs: 3000,
      reason: 'unavailable',
      status: 503,
    });
    expect(classifyResponse(503, headers({}), 0)).toEqual({
      kind: 'retry',
      afterMs: 0,
      reason: 'unavailable',
      status: 503,
    });
    expect(classifyResponse(500, headers({ 'retry-after': '3' }), 0)).toEqual({
      kind: 'retry',
      afterMs: 0,
      reason: 'unavailable',
      status: 500,
    });
  });
});

describe('maybeCompress', () => {
  it('compresses large bodies within the ratio', async () => {
    const body = Array.from({ length: 200 }, (_, i) => `line ${i} ${Math.sin(i)}`).join(',');
    const result = await maybeCompress(body, gzip, 1024);
    expect(result.encoding).toBe('gzip');
  });

  it('skips small bodies, missing compressors, failures and ratios over 50:1', async () => {
    expect(await maybeCompress('small', gzip, 1024)).toEqual({ body: 'small' });
    const big = 'a'.repeat(100_000);
    expect(await maybeCompress(big, undefined, 10)).toEqual({ body: big });
    expect(await maybeCompress(big, gzip, 10)).toEqual({ body: big });
    expect(await maybeCompress(big, () => Promise.resolve(undefined), 10)).toEqual({ body: big });
    expect(await maybeCompress(big, () => Promise.reject(new Error('x')), 10)).toEqual({
      body: big,
    });
  });
});

function fakeFetch(status = 200, responseHeaders: Record<string, string> = {}) {
  return vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response(null, { status, headers: responseHeaders })),
  );
}

describe('makeFetchTransport', () => {
  it('posts with the content type, auth headers and keepalive under the limit', async () => {
    const fetch = fakeFetch();
    const transport = makeFetchTransport({
      fetch,
      contentType: 'text/plain;charset=UTF-8',
      keepaliveMaxBytes: 10,
      fetchInit: { credentials: 'omit' },
    });
    expect(
      await transport.send({ ...request, headers: { 'X-Beacon-Auth': 'Beacon beacon_key=k' } }),
    ).toEqual({ kind: 'ok' });
    const [url, init] = fetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(request.url);
    expect(init).toMatchObject({
      method: 'POST',
      body: 'x',
      keepalive: true,
      credentials: 'omit',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'X-Beacon-Auth': 'Beacon beacon_key=k',
      },
    });
    await transport.send({ ...request, body: 'x'.repeat(20) });
    expect(fetch.mock.calls[1]![1]!.keepalive).toBe(false);
  });

  it('uses the default content type and global fetch', async () => {
    const fetch = fakeFetch(429, { 'Retry-After': '9' });
    vi.stubGlobal('fetch', fetch);
    const transport = makeFetchTransport();
    expect(await transport.send(request)).toEqual({
      kind: 'retry',
      afterMs: 9000,
      reason: 'ratelimit',
      status: 429,
    });
    expect(fetch.mock.calls[0]![1]!.headers).toEqual({
      'Content-Type': 'application/x-beacon-envelope',
    });
  });

  it('gzips large bodies but never on unload unless allowed', async () => {
    const fetch = fakeFetch();
    const body = Array.from({ length: 400 }, (_, i) => `entry-${i}-${(i * 7919) % 1000}`).join('|');
    const transport = makeFetchTransport({ fetch, compress: gzip, compressMinBytes: 100 });
    await transport.send({ ...request, body });
    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({ 'Content-Encoding': 'gzip' });
    expect(fetch.mock.calls[0]![1]!.body).toBeInstanceOf(Uint8Array);
    await transport.send({ ...request, body, unload: true });
    expect(fetch.mock.calls[1]![1]!.headers).not.toHaveProperty('Content-Encoding');
    await makeFetchTransport({
      fetch,
      compress: gzip,
      compressMinBytes: 100,
      compressOnUnload: true,
    }).send({ ...request, body, unload: true });
    expect(fetch.mock.calls[2]![1]!.headers).toMatchObject({ 'Content-Encoding': 'gzip' });
    await makeFetchTransport({ fetch, compress: gzip }).send({ ...request, body: 'tiny' });
    expect(fetch.mock.calls[3]![1]!.headers).not.toHaveProperty('Content-Encoding');
  });

  it('uses sendBeacon on unload when there are no custom headers', async () => {
    const fetch = fakeFetch();
    const sendBeacon = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const transport = makeFetchTransport({
      fetch,
      sendBeacon,
      contentType: 'text/plain;charset=UTF-8',
    });
    expect(await transport.send({ ...request, unload: true })).toEqual({ kind: 'ok' });
    expect(sendBeacon).toHaveBeenCalledWith(request.url, 'x', 'text/plain;charset=UTF-8');
    expect(await transport.send({ ...request, unload: true })).toEqual({
      kind: 'retry',
      afterMs: 0,
      reason: 'unavailable',
    });
    await transport.send({ ...request, unload: true, headers: { 'X-Beacon-Auth': 'k' } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps network errors and timeouts to retries', async () => {
    const failing = makeFetchTransport({
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
      networkRetryMs: 60000,
    });
    expect(await failing.send(request)).toEqual({
      kind: 'retry',
      afterMs: 60000,
      reason: 'network',
    });
    const hanging = makeFetchTransport({
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
      timeoutMs: 5,
    });
    expect(await hanging.send(request)).toEqual({ kind: 'retry', afterMs: 0, reason: 'network' });
  });

  it('flushes in-flight requests within a timeout', async () => {
    let resolve!: (response: Response) => void;
    const transport = makeFetchTransport({
      fetch: () => new Promise<Response>((r) => (resolve = r)),
      now: () => 0,
    });
    expect(await transport.flush(10)).toBe(true);
    const pending = transport.send(request);
    expect(await transport.flush(5)).toBe(false);
    resolve(new Response(null, { status: 200 }));
    expect(await transport.flush(1000)).toBe(true);
    await pending;
  });
});
