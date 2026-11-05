import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { channel } from 'node:diagnostics_channel';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  close,
  getCurrentScope,
  initClient,
  withScope,
  type BeaconEvent,
  type PlatformConfig,
} from '@nowo-tech/beacon-core';
import { nodePlatform } from '../src/init.js';
import { consoleIntegration } from '../src/integrations/console.js';
import { contextLinesIntegration } from '../src/integrations/context-lines.js';
import { contextIntegration } from '../src/integrations/context.js';
import { httpIntegration } from '../src/integrations/http.js';
import { requestIsolationIntegration } from '../src/integrations/isolation.js';
import { recordingTransport, SERVER_DSN } from './helpers.js';

const publish = (name: string, message: unknown): void => channel(name).publish(message);

afterEach(async () => {
  await close(100);
  getCurrentScope().breadcrumbs = [];
});

function setup(...integrations: PlatformConfig['defaultIntegrations']) {
  const transport = recordingTransport();
  return initClient(
    { dsn: SERVER_DSN, transport },
    { ...nodePlatform(), defaultIntegrations: integrations },
  );
}

describe('Http breadcrumbs', () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      res.statusCode = req.url?.startsWith('/fail')
        ? 503
        : req.url?.startsWith('/missing')
          ? 404
          : 200;
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('records http and fetch requests with scrubbed URLs, status and duration', async () => {
    setup(httpIntegration());
    await new Promise<void>((resolve) => {
      httpRequest(`http://127.0.0.1:${port}/ok?token=abc`, (res) => {
        res.resume();
        res.on('end', resolve);
      }).end();
    });
    await (await fetch(`http://127.0.0.1:${port}/fail?code=1`)).text();
    await (await fetch(`http://127.0.0.1:${port}/missing`)).text();
    const crumbs = getCurrentScope().breadcrumbs;
    expect(crumbs[0]).toMatchObject({
      type: 'http',
      category: 'http',
      level: 'info',
      data: {
        method: 'GET',
        url: `http://127.0.0.1:${port}/ok?token=[Filtered]`,
        status_code: 200,
      },
    });
    expect(crumbs[0]!.data!['duration_ms']).toEqual(expect.any(Number));
    expect(crumbs[1]).toMatchObject({
      category: 'fetch',
      level: 'error',
      data: { url: `http://127.0.0.1:${port}/fail?code=[Filtered]`, status_code: 503 },
    });
    expect(crumbs[2]).toMatchObject({ level: 'warning', data: { status_code: 404 } });
  });

  it('records network errors, skips the Beacon host and unknown requests', () => {
    setup(httpIntegration(() => 5));
    const failed = {};
    publish('undici:request:create', {
      request: Object.assign(failed, { method: 'post', origin: 'https://api.test', path: '/x' }),
    });
    publish('undici:request:error', { request: failed, error: new Error('reset') });
    const beacon = {};
    publish('undici:request:create', {
      request: Object.assign(beacon, { origin: 'https://beacon.test', path: '/api/1/envelope/' }),
    });
    publish('undici:request:headers', { request: beacon, response: { statusCode: 200 } });
    publish('undici:request:headers', { request: {}, response: { statusCode: 200 } });
    const bare = {};
    publish('http.client.request.start', { request: bare });
    publish('http.client.request.error', { request: bare, error: new Error('x') });
    publish('http.client.response.finish', { request: {} });
    const headerless = { getHeader: () => undefined, host: 'h.test', path: '/p' };
    publish('http.client.request.start', { request: headerless });
    publish('http.client.response.finish', { request: headerless, response: { statusCode: 201 } });
    const odd = {};
    publish('undici:request:create', { request: odd });
    publish('undici:request:headers', { request: odd });
    const crumbs = getCurrentScope().breadcrumbs;
    expect(crumbs.map((c) => [c.category, c.data!['method'], c.data!['url'], c.level])).toEqual([
      ['fetch', 'POST', 'https://api.test/x', 'error'],
      ['http', 'GET', 'http://', 'error'],
      ['http', 'GET', 'http://h.test/p', 'info'],
      ['fetch', 'GET', '', 'error'],
    ]);
    expect(crumbs[0]!.data!['status_code']).toBeUndefined();
  });

  it('unsubscribes on teardown', async () => {
    setup(httpIntegration());
    await close(10);
    publish('undici:request:create', { request: { origin: 'https://a.test', path: '/' } });
    expect(getCurrentScope().breadcrumbs).toHaveLength(0);
  });
});

describe('Console breadcrumbs', () => {
  it('records warn/error, calls the originals and restores them', async () => {
    const calls: unknown[][] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...args: unknown[]) => calls.push(['warn', ...args]);
    console.error = (...args: unknown[]) => calls.push(['error', ...args]);
    try {
      const wrappedWarn = console.warn;
      setup(consoleIntegration());
      const throwing = {
        toString: () => {
          throw new Error('no');
        },
      };
      console.warn('careful', 42);
      console.error(throwing);
      console.warn('[beacon] internal');
      expect(calls).toEqual([
        ['warn', 'careful', 42],
        ['error', throwing],
        ['warn', '[beacon] internal'],
      ]);
      expect(getCurrentScope().breadcrumbs.map((c) => [c.level, c.message])).toEqual([
        ['warning', 'careful 42'],
        ['error', '[unserializable]'],
      ]);
      await close(10);
      expect(console.warn).toBe(wrappedWarn);
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }
  });
});

describe('Context', () => {
  it('adds runtime, os, app and device; server_name only with sendDefaultPii', () => {
    const event = contextIntegration().processEvent!(
      { contexts: { app: { custom: true } } },
      {},
      undefined as never,
    ) as BeaconEvent;
    expect(event.contexts!['runtime']).toEqual({ name: 'node', version: process.versions.node });
    expect(event.contexts!['app']).toEqual({ custom: true });
    expect(event.contexts!['device']).toEqual({ arch: process.arch });
    expect(event.server_name).toBeUndefined();
    const pii = contextIntegration({ sendDefaultPii: true }).processEvent!(
      {},
      {},
      undefined as never,
    ) as BeaconEvent;
    expect(pii.server_name).toEqual(expect.any(String));
    expect(
      contextIntegration({ sendDefaultPii: true }).processEvent!(
        { server_name: 'set' },
        {},
        undefined as never,
      )!.server_name,
    ).toBe('set');
    expect(
      (contextIntegration().processEvent!({}, {}, undefined as never) as BeaconEvent).contexts![
        'app'
      ],
    ).toHaveProperty('app_start_time');
  });
});

describe('ContextLines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beacon-lines-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'app.js');
  writeFileSync(file, Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'));
  const big = join(dir, 'big.js');
  writeFileSync(big, 'x'.repeat(1024 * 1024 + 1));

  it('adds 5 lines of context to in_app frames only', () => {
    const integration = contextLinesIntegration();
    const frames = [
      { abs_path: file, lineno: 10, in_app: true },
      { abs_path: pathToFileURL(file).href, lineno: 2, in_app: true },
      { abs_path: file, lineno: 3, in_app: false },
      { abs_path: file, lineno: 99, in_app: true },
      { abs_path: big, lineno: 1, in_app: true },
      { abs_path: join(dir, 'missing.js'), lineno: 1, in_app: true },
      { abs_path: 'relative.js', lineno: 1, in_app: true },
      { abs_path: file, in_app: true },
      { lineno: 1, in_app: true },
      { abs_path: file, lineno: 10, in_app: true },
    ];
    integration.processEvent!(
      {
        exception: {
          values: [
            { type: 'E', value: 'v', stacktrace: { frames } },
            { type: 'F', value: 'w' },
          ],
        },
      },
      {},
      undefined as never,
    );
    integration.processEvent!({}, {}, undefined as never);
    expect(frames[0]).toMatchObject({
      pre_context: ['line 5', 'line 6', 'line 7', 'line 8', 'line 9'],
      context_line: 'line 10',
      post_context: ['line 11', 'line 12', 'line 13', 'line 14', 'line 15'],
    });
    expect(frames[1]).toMatchObject({ pre_context: ['line 1'], context_line: 'line 2' });
    for (const index of [2, 3, 4, 5, 6, 7, 8])
      expect(frames[index]).not.toHaveProperty('context_line');
    expect(frames[9]).toMatchObject({ context_line: 'line 10' });
  });

  it('keeps at most 100 files in its LRU cache', () => {
    const integration = contextLinesIntegration();
    const frames = Array.from({ length: 101 }, (_, i) => ({
      abs_path: join(dir, `none-${i}.js`),
      lineno: 1,
      in_app: true,
    }));
    frames.push({ abs_path: join(dir, 'none-0.js'), lineno: 1, in_app: true });
    integration.processEvent!(
      { exception: { values: [{ type: 'E', value: 'v', stacktrace: { frames } }] } },
      {},
      undefined as never,
    );
    expect(frames[0]).not.toHaveProperty('context_line');
  });
});

describe('RequestIsolation', () => {
  it('keeps 50 concurrent requests isolated', async () => {
    setup(requestIsolationIntegration());
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        withScope(async (scope) => {
          scope.setTag('request', String(i));
          scope.setUser({ id: `u${i}` });
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
          getCurrentScope().addBreadcrumb({ message: `crumb ${i}` }, 100);
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
          const current = getCurrentScope();
          return [
            current.tags['request'],
            current.user!.id,
            current.breadcrumbs.map((b) => b.message),
          ];
        }),
      ),
    );
    results.forEach((result, i) => expect(result).toEqual([String(i), `u${i}`, [`crumb ${i}`]]));
    expect(getCurrentScope().tags['request']).toBeUndefined();
    await close(10);
    expect(withScope((scope) => getCurrentScope() === scope)).toBe(true);
  });
});
