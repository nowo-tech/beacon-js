import type { AddressInfo } from 'node:net';
import express, { type Request } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addBreadcrumb,
  close,
  getCurrentScope,
  init,
  setTag,
  type TransportRequest,
} from '@nowo-tech/beacon-node';
import {
  beaconErrorHandler,
  beaconRequestHandler,
  bodyOf,
  defaultShouldHandleError,
  requestDataOf,
} from '../src/index.js';

const SERVER_DSN =
  'https://test-public:test-secret-not-real@beacon.test/00000000-0000-4000-8000-000000000001';
let requests: TransportRequest[] = [];

function setup(sendDefaultPii = false) {
  requests = [];
  init({
    dsn: SERVER_DSN,
    sendDefaultPii,
    includeSourceContext: false,
    integrations: (defaults) =>
      defaults.filter((i) => ['RequestIsolation', 'Context'].includes(i.name)),
    transport: {
      send: (r) => (requests.push(r), Promise.resolve({ kind: 'ok' })),
      flush: () => Promise.resolve(true),
    },
  });
}

const events = () => requests.map((r) => JSON.parse(r.body.split('\n')[2]!) as Record<string, any>);

function app(
  options: Parameters<typeof beaconRequestHandler>[0] = {},
  errorOptions: Parameters<typeof beaconErrorHandler>[0] = {},
) {
  const application = express();
  application.use(express.json());
  application.use(beaconRequestHandler(options));
  application.get('/users/:id', (req, _res) => {
    setTag('user', req.params['id']!);
    addBreadcrumb({ message: `load ${req.params['id']}` });
    throw new Error(`user ${req.params['id']} failed`);
  });
  application.post('/async', async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    throw Object.assign(new Error('async boom'), { status: 502 });
  });
  application.get('/teapot', () => {
    throw Object.assign(new Error('teapot'), { statusCode: 418 });
  });
  application.get('/slow/:id', async (req, res) => {
    setTag('request', req.params['id']!);
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
    res.json({ tag: getCurrentScope().tags['request'], url: getCurrentScope().request?.url });
  });
  application.use(beaconErrorHandler(errorOptions));
  application.use(
    (error: Error, _req: Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: error.message, eventId: res.locals['beaconEventId'] });
    },
  );
  return application;
}

async function serve(
  application: express.Express,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = application.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

beforeEach(() => setup());
afterEach(async () => {
  await close(100);
});

describe('beacon-express', () => {
  it('captures a route error with a scrubbed request, the route and no IP or cookie', async () => {
    const { url, stop } = await serve(app());
    const response = await fetch(`${url}/users/42?token=abc&q=ok`, {
      headers: {
        'X-Forwarded-For': '203.0.113.9',
        'X-Real-IP': '203.0.113.9',
        Cookie: 'sid=1',
        Authorization: 'Bearer abc',
        Accept: 'application/json',
      },
    });
    const body = (await response.json()) as { eventId: string };
    await stop();
    const [event] = events();
    expect(body.eventId).toBe(event!['event_id']);
    expect(event).toMatchObject({
      platform: 'node',
      logger: 'express',
      tags: { user: '42', route: 'GET /users/:id' },
      request: { method: 'GET', url: `${url}/users/42?token=[Filtered]&q=ok`, route: '/users/:id' },
      exception: {
        values: [{ value: 'user 42 failed', mechanism: { type: 'express', handled: false } }],
      },
    });
    expect(event!['request'].headers).toMatchObject({ accept: 'application/json' });
    expect(event!['request'].headers).not.toHaveProperty('cookie');
    expect(event!['request'].headers).not.toHaveProperty('authorization');
    expect(requests[0]!.body).not.toContain('203.0.113.9');
    expect(event!['breadcrumbs'].values[0].message).toBe('load 42');
  });

  it('captures async rejections (Express 5) with the body when asked, and skips 4xx', async () => {
    const { url, stop } = await serve(app({ includeBody: true }));
    await fetch(`${url}/async`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'n', password: 'p' }),
    });
    await fetch(`${url}/teapot`);
    await stop();
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      request: { method: 'POST', data: { name: 'n', password: '[Filtered]' } },
      exception: { values: [{ value: 'async boom' }] },
    });
  });

  it('keeps 50 concurrent requests isolated', async () => {
    const { url, stop } = await serve(app());
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        fetch(`${url}/slow/${i}`).then((r) => r.json() as Promise<{ tag: string; url: string }>),
      ),
    );
    await stop();
    results.forEach((result, i) =>
      expect(result).toEqual({ tag: String(i), url: `${url}/slow/${i}` }),
    );
  });

  it('never records cookies, credentials or client addresses, even with sendDefaultPii or allowHeaders', async () => {
    await close(10);
    setup(true);
    const ipHeaders = {
      'x-forwarded-for': '203.0.113.9',
      'x-original-forwarded-for': '203.0.113.20',
      'x-cluster-client-ip': '203.0.113.21',
      'fastly-client-ip': '203.0.113.22',
      'x-vercel-forwarded-for': '203.0.113.23',
      'cf-connecting-ip': '203.0.113.24',
      'cf-pseudo-ipv4': '203.0.113.25',
      'true-client-ip': '203.0.113.26',
      'x-envoy-external-address': '203.0.113.27',
      'x-appengine-user-ip': '203.0.113.28',
      'x-real-ip': '203.0.113.29',
      forwarded: 'for=203.0.113.30',
    };
    const listed = [...Object.keys(ipHeaders), 'cookie', 'authorization', 'x-api-key', 'x-custom'];
    const { url, stop } = await serve(app({ allowHeaders: listed }));
    await fetch(`${url}/users/1`, {
      headers: {
        ...ipHeaders,
        Cookie: 'sid=1',
        Authorization: 'Bearer tok',
        'x-api-key': 'k1',
        'x-custom': 'kept',
        'x-unlisted': 'dropped',
        referer: 'https://shop.test/cart?coupon=SECRET#top',
        'user-agent': 'ua/1',
      },
    });
    await stop();
    const headers = events()[0]!['request'].headers;
    expect(headers).toEqual({
      'x-custom': 'kept',
      referer: 'https://shop.test/cart',
      'user-agent': 'ua/1',
      accept: '*/*',
      'accept-encoding': expect.any(String),
      'accept-language': '*',
    });
    expect(requests[0]!.body).not.toMatch(/203\.0\.113\.|sid=1|tok|k1|SECRET/);
  });

  it('never sends a large body, scrubbing keys before any size limit (FV-M1 PoC)', async () => {
    const { url, stop } = await serve(app({ includeBody: true }));
    await fetch(`${url}/async`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'u',
        password: 'big-pass-LEAK',
        padding: 'x'.repeat(12_000),
      }),
    });
    await stop();
    expect(events()[0]!['request'].data).toBe('[truncated]');
    expect(requests[0]!.body).not.toContain('big-pass-LEAK');
  });

  it('parses JSON and form bodies sent as text, and never sends unparsable text', () => {
    expect(bodyOf('{"password":"p","note":"Bearer abc","n":1}', 'application/json')).toEqual({
      password: '[Filtered]',
      note: 'Bearer [Filtered]',
      n: 1,
    });
    expect(
      bodyOf(
        new TextEncoder().encode('token=t&name=n&card=4111111111111111'),
        'application/x-www-form-urlencoded',
      ),
    ).toEqual({ token: '[Filtered]', name: 'n', card: '[Filtered]' });
    expect(bodyOf('plain text password=hunter2', 'text/plain')).toBe('[unparsed]');
    expect(bodyOf('{not json', 'application/json')).toBe('[unparsed]');
    expect(bodyOf('x')).toBe('[unparsed]');
    expect(bodyOf([{ secret: 's' }, 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln'])).toEqual([
      { secret: '[Filtered]' },
      '[Filtered]',
    ]);
    expect(bodyOf(undefined)).toBeUndefined();
  });

  it('passes the app error through unchanged when capturing fails, and keeps going without request data', async () => {
    const application = express();
    application.use(beaconRequestHandler({ includeBody: true }));
    application.get('/weird', () => {
      const error = new Error('original');
      Object.defineProperty(error, 'stack', {
        get() {
          throw new Error('getter');
        },
      });
      throw error;
    });
    application.use(beaconErrorHandler());
    application.use(
      (error: Error, _req: Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ seen: error.message });
      },
    );
    const { url, stop } = await serve(application);
    const response = await fetch(`${url}/weird`);
    expect(await response.json()).toEqual({ seen: 'original' });
    await stop();
    const broken = {
      get: () => {
        throw new Error('broken request');
      },
    } as unknown as Request;
    let nextCalled = 0;
    beaconRequestHandler()(broken, {} as express.Response, () => nextCalled++);
    expect(nextCalled).toBe(1);
    const seen: unknown[] = [];
    const original = new Error('app error');
    beaconErrorHandler({
      shouldHandleError: () => {
        throw new Error('sdk');
      },
    })(original, broken, { locals: {} } as express.Response, (e?: unknown) => seen.push(e));
    expect(seen).toEqual([original]);
  });

  it('honours shouldHandleError and works without the request handler or a client', async () => {
    const application = express();
    application.use('/mw', (_req, _res, next) => next(new Error('middleware')));
    application.get('/x', () => {
      throw new Error('x');
    });
    application.use(beaconErrorHandler({ shouldHandleError: () => true }));
    application.use(
      (_error: Error, _req: Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).end();
      },
    );
    const { url, stop } = await serve(application);
    await fetch(`${url}/x`);
    expect(events()[0]!['request']).toMatchObject({ method: 'GET', route: '/x' });
    await fetch(`${url}/mw`);
    expect(events()[1]!['request']).not.toHaveProperty('route');
    await close(10);
    await fetch(`${url}/x`);
    await stop();
    expect(events()).toHaveLength(2);
    const skipping = app({}, { shouldHandleError: () => false });
    expect(skipping).toBeDefined();
  });

  it('builds request data defensively', () => {
    const req = {
      method: 'PUT',
      protocol: 'https',
      originalUrl: '/p#frag',
      headers: { multi: ['a', 'b'], missing: undefined, other: 'no' },
      get: () => undefined,
      body: { big: 'x'.repeat(20_000), more: 'y'.repeat(9000) },
    } as unknown as Request;
    const data = requestDataOf(req, { includeBody: true, allowHeaders: ['Multi', 'missing'] });
    expect(data).toMatchObject({
      method: 'PUT',
      url: 'https://localhost/p',
      headers: { multi: 'a, b' },
    });
    expect(data.headers).toEqual({ multi: 'a, b' });
    expect(data.data).toBe('[truncated]');
    expect(
      requestDataOf({ ...req, body: undefined } as Request, { includeBody: true }),
    ).not.toHaveProperty('data');
    expect(
      requestDataOf({ ...req, body: { a: 1 } } as Request, { includeBody: true }).data,
    ).toEqual({ a: 1 });
  });

  it('decides by status', () => {
    expect(defaultShouldHandleError(new Error('x'))).toBe(true);
    expect(defaultShouldHandleError('x')).toBe(true);
    expect(defaultShouldHandleError(null)).toBe(true);
    expect(defaultShouldHandleError({ status: 404 })).toBe(false);
    expect(defaultShouldHandleError({ statusCode: '503' })).toBe(true);
    expect(defaultShouldHandleError({ output: { statusCode: 400 } })).toBe(false);
    expect(defaultShouldHandleError({ status: 'weird' })).toBe(true);
  });
});
