import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as node from '../src/index.js';
import {
  BROWSER_DSN,
  eventOf,
  fakeProcess,
  headerOf,
  recordingTransport,
  SERVER_DSN,
} from './helpers.js';

afterEach(async () => {
  await node.close(100);
});

type Init = RequestInit & { headers: Record<string, string> };
const textOf = (init: Init): string =>
  init.headers['Content-Encoding'] === 'gzip'
    ? gunzipSync(init.body as Uint8Array).toString()
    : (init.body as string);

function stubFetch() {
  const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response(null, { status: 200 })),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('init', () => {
  it('sends X-Beacon-Auth, platform node and never the secret in the URL, header line or body', async () => {
    const fetch = stubFetch();
    const warn = vi.spyOn(console, 'warn');
    node.init({ dsn: SERVER_DSN, process: fakeProcess(), release: 'api@1.0.0', debug: true });
    const id = node.captureException(new Error('boom'));
    await node.flush(2000);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://beacon.test/api/00000000-0000-4000-8000-000000000001/envelope/');
    expect(url).not.toMatch(/beacon_key|beacon_secret|sentry_key|bk_|secret/);
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/x-beacon-envelope',
      'X-Beacon-Auth': 'Beacon beacon_key=test-public, beacon_secret=test-secret-not-real',
    });
    const body = textOf(init as Init);
    expect(body).not.toContain('test-secret-not-real');
    const request = { url, headers: {}, body, category: 'error' as const };
    expect(headerOf(request)).toEqual({
      event_id: id,
      sdk: { name: 'nowo.javascript.node', version: node.SDK_VERSION },
      sent_at: expect.any(String),
    });
    const event = eventOf(request);
    expect(event).toMatchObject({
      platform: 'node',
      release: 'api@1.0.0',
      level: 'error',
      contexts: { runtime: { name: 'node' } },
    });
    expect(event['sdk'].integrations).toEqual([
      'RequestIsolation',
      'Dedupe',
      'Context',
      'ContextLines',
      'OnUncaughtException',
      'OnUnhandledRejection',
      'Http',
      'Console',
      'Shutdown',
    ]);
    const frame = event['exception'].values[0].stacktrace.frames.at(-1);
    expect(frame.filename).toBe('test/init.test.ts');
    expect(frame.context_line).toContain("new Error('boom')");
    for (const call of warn.mock.calls)
      expect(String(call[0])).not.toContain('test-secret-not-real');
  });

  it('refuses a browser key and a DSN without secret, without leaking the DSN', () => {
    for (const dsn of [BROWSER_DSN, SERVER_DSN.replace(':test-secret-not-real', '')]) {
      let error: unknown;
      try {
        node.init({ dsn, process: fakeProcess() });
      } catch (e) {
        error = e;
      }
      expect((error as Error).message).toMatch(/browser key|needs a secret/);
      expect((error as Error).message).not.toContain('test-public');
    }
  });

  it('gzips bodies over 1 kB and sends highly repetitive bodies uncompressed (50:1 guard)', async () => {
    const fetch = stubFetch();
    node.init({ dsn: SERVER_DSN, process: fakeProcess(), includeSourceContext: false });
    const varied = Array.from({ length: 300 }, (_, i) => `${i}:${(i * 7919) % 997}`).join(',');
    node.captureMessage(varied);
    node.captureMessage('repetitive', 'info', {
      extra: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, 'a'.repeat(2000)])),
    });
    node.captureMessage('small');
    await node.flush(2000);
    const inits = fetch.mock.calls.map((call) => call[1] as Init);
    const find = (needle: string) => inits.find((init) => textOf(init).includes(needle))!;
    expect(find(varied.slice(0, 50)).headers['Content-Encoding']).toBe('gzip');
    expect(find('repetitive').headers['Content-Encoding']).toBeUndefined();
    expect(find('small').headers['Content-Encoding']).toBeUndefined();
  });

  it('can disable compression and use a file, memory or no queue', async () => {
    const fetch = stubFetch();
    node.init({
      dsn: SERVER_DSN,
      process: fakeProcess(),
      compression: false,
      queue: { type: 'file', dir: `/tmp/beacon-node-test-${process.pid}` },
    });
    node.captureMessage('x'.repeat(5000) + Math.random());
    await node.flush(2000);
    expect(
      (fetch.mock.calls[0]![1] as { headers: Record<string, string> }).headers['Content-Encoding'],
    ).toBeUndefined();
    const transport = recordingTransport();
    node.init({ dsn: SERVER_DSN, process: fakeProcess(), transport, queue: false });
    node.init({
      dsn: SERVER_DSN,
      process: fakeProcess(),
      transport,
      queue: node.makeMemoryQueue(),
    });
    expect(node.getClient()!.isActive()).toBe(true);
  });

  it('builds the platform config with defaults', () => {
    const platform = node.nodePlatform();
    expect(platform).toMatchObject({
      platform: 'node',
      maxEnvelopeBytes: 1048576,
      lowerOnly: false,
      inFlightCap: 30,
      identicalWindowMs: 10000,
      onConfigError: 'throw',
    });
    expect(platform.throttle).toEqual({ perMinute: 100, burst: 20, refillPerSecond: 1.6 });
    expect(platform.defaultQueue!()).toBeDefined();
    expect(platform.normalizeFilename(`${process.cwd()}/src/a.js`)).toBe('src/a.js');
    expect(node.defaultNodeIntegrations().map((i) => i.name)).toContain('ContextLines');
    expect(
      node
        .defaultNodeIntegrations({
          dsn: '',
          includeSourceContext: false,
          sendDefaultPii: true,
          exitOnUncaught: false,
          unhandledRejections: 'warn',
          shutdownHandlers: ['SIGTERM'],
          shutdownTimeoutMs: 10,
        })
        .map((i) => i.name),
    ).not.toContain('ContextLines');
  });
});
