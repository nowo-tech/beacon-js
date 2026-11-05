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

  it('keeps cookies and authorization headers with sendDefaultPii (redacted by the scrubber)', async () => {
    await close(10);
    setup(true);
    const { url, stop } = await serve(app());
    await fetch(`${url}/users/1`, { headers: { Cookie: 'sid=1' } });
    await stop();
    expect(events()[0]!['request'].headers.cookie).toBe('[Filtered]');
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
      headers: { multi: ['a', 'b'], missing: undefined },
      get: () => undefined,
      body: { big: 'x'.repeat(20_000), more: 'y'.repeat(9000) },
    } as unknown as Request;
    const data = requestDataOf(req, { includeBody: true });
    expect(data).toMatchObject({
      method: 'PUT',
      url: 'https://localhost/p',
      headers: { multi: 'a, b' },
    });
    expect(typeof data.data).toBe('string');
    expect((data.data as string).length).toBe(10 * 1024);
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
