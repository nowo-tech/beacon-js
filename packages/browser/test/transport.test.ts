import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BROWSER_CONTENT_TYPE,
  compressionStreamGzip,
  makeBrowserTransport,
} from '../src/transport.js';
import { ENVELOPE_URL, stubFetch } from './helpers.js';

const request = { url: ENVELOPE_URL, headers: {}, body: 'x', category: 'error' as const };

afterEach(() => vi.unstubAllGlobals());

describe('browser transport', () => {
  it('sends a CORS simple request without credentials', async () => {
    const { fetch } = stubFetch();
    expect(await makeBrowserTransport().send(request)).toEqual({ kind: 'ok' });
    const init = fetch.mock.calls[0]![1]!;
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      mode: 'cors',
      referrerPolicy: 'strict-origin',
      keepalive: true,
      headers: { 'Content-Type': BROWSER_CONTENT_TYPE },
    });
  });

  it('uses sendBeacon on unload with a text/plain Blob', async () => {
    const sendBeacon = vi.spyOn(navigator, 'sendBeacon').mockReturnValue(true);
    stubFetch();
    const transport = makeBrowserTransport({ compression: false });
    expect(await transport.send({ ...request, unload: true })).toEqual({ kind: 'ok' });
    const blob = sendBeacon.mock.calls[0]![1] as Blob;
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(await blob.text()).toBe('x');
  });

  it('works without sendBeacon', async () => {
    const { fetch } = stubFetch();
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: undefined });
    await makeBrowserTransport({ fetch }).send({ ...request, unload: true });
    expect(fetch).toHaveBeenCalled();
  });

  it("sends bodies over 32 kB uncompressed by default and gzips them with compression: 'auto'", async () => {
    const body = Array.from({ length: 6000 }, (_, i) => `${i}:${(i * 7919) % 997}`).join(',');
    expect(body.length).toBeGreaterThan(32_768);
    const { fetch } = stubFetch();
    await makeBrowserTransport({ fetch }).send({ ...request, body });
    const plain = fetch.mock.calls[0]![1]!;
    expect((plain.headers as Record<string, string>)['Content-Encoding']).toBeUndefined();
    expect(plain.body).toBe(body);
    await makeBrowserTransport({ fetch, compression: 'auto' }).send({ ...request, body });
    const gzipped = fetch.mock.calls[1]![1]!;
    expect((gzipped.headers as Record<string, string>)['Content-Encoding']).toBe('gzip');
    expect(gzipped.body).toBeInstanceOf(Uint8Array);
  });

  it('gzips with CompressionStream, and skips without it', async () => {
    const body = 'x'.repeat(10);
    const gz = await compressionStreamGzip(body);
    expect(gz![0]).toBe(0x1f);
    expect(gz![1]).toBe(0x8b);
    vi.stubGlobal('CompressionStream', undefined);
    expect(await compressionStreamGzip(body)).toBeUndefined();
  });
});
