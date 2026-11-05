import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { beaconErrorHandler, beaconRequestHandler } from '@nowo-tech/beacon-express';
import * as Beacon from '@nowo-tech/beacon-node';
import express from 'express';
import { events, startMock, waitFor } from './helpers.mjs';

let ctx;
let app;
let server;
let appUrl;

before(async () => {
  ctx = await startMock();
  Beacon.init({
    dsn: ctx.dsn,
    release: 'e2e@1.0.0',
    exitOnUncaught: false,
    unhandledRejections: 'warn',
    throttle: { perMinute: 1000, burst: 1000, refillPerSecond: 100 },
  });
  app = express();
  app.use(beaconRequestHandler());
  app.get('/users/:id', (req) => {
    Beacon.setTag('user', req.params.id);
    Beacon.addBreadcrumb({ category: 'app', message: `load ${req.params.id}` });
    throw new Error(`User ${req.params.id} not found`);
  });
  app.get('/slow/:id', async (req, res) => {
    Beacon.setTag('request_id', req.params.id);
    Beacon.addBreadcrumb({ category: 'app', message: `slow ${req.params.id}` });
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 30));
    if (Number(req.params.id) % 2) throw new Error(`odd ${req.params.id}`);
    res.send('ok');
  });
  app.get('/big', () => {
    throw new Error(
      `big ${'payload '.repeat(500)}${Array.from({ length: 300 }, (_, i) => i * 7919).join(',')}`,
    );
  });
  app.use(beaconErrorHandler());
  app.use((err, _req, res, _next) => res.status(500).send('error'));
  await new Promise((resolve) => (server = app.listen(0, '127.0.0.1', resolve)));
  appUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await Beacon.close(2000);
  server.close();
  await ctx.mock.close();
});

beforeEach(() => ctx.mock.reset());

describe('Express app → mock Beacon', () => {
  it('a route error becomes an event with a scrubbed request and server auth', async () => {
    const response = await fetch(`${appUrl}/users/42?token=abc&page=2`, {
      headers: {
        authorization: 'Bearer secret-value',
        'x-forwarded-for': '203.0.113.9',
        'x-original-forwarded-for': '203.0.113.20',
        'fastly-client-ip': '203.0.113.21',
        cookie: 'sid=1',
      },
    });
    assert.equal(response.status, 500);
    await Beacon.flush(2000);
    const [{ request, event }] = events(ctx.mock);
    assert.equal(request.status, 200);
    assert.equal(
      request.headers['x-beacon-auth'],
      'Beacon beacon_key=test-public, beacon_secret=test-secret-not-real',
    );
    assert.equal(request.headers['content-type'], 'application/x-beacon-envelope');
    assert.ok(!request.query.includes('beacon'), 'no credentials in the URL');
    assert.ok(!request.body.includes('test-secret-not-real'), 'no secret in the body');
    assert.equal(request.envelope.header.dsn, undefined);
    assert.equal(event.platform, 'node');
    assert.equal(event.release, 'e2e@1.0.0');
    assert.equal(event.exception.values.at(-1).value, 'User 42 not found');
    assert.equal(event.exception.values.at(-1).mechanism.type, 'express');
    assert.match(event.request.url, /\/users\/42\?token=\[Filtered\]&page=2$/);
    assert.equal(event.request.headers['x-forwarded-for'], undefined);
    assert.ok(!JSON.stringify(event).includes('203.0.113.9'), 'no client IP');
    assert.ok(!JSON.stringify(event).includes('secret-value'));
    assert.equal(event.tags.user, '42');
    const frame = event.exception.values.at(-1).stacktrace.frames.at(-1);
    assert.equal(frame.in_app, true);
    assert.ok(!frame.filename.startsWith('/'), `relative filename: ${frame.filename}`);
    // Only allow-listed headers are recorded (no host, no client address, no credentials), and no client address
    // may appear in the fields that would carry one.
    assert.equal(event.request.headers.host, undefined);
    assert.equal(event.request.headers.authorization, undefined);
    assert.equal(event.request.headers.cookie, undefined);
    const clientFields = JSON.stringify({
      user: event.user,
      headers: event.request.headers,
      env: event.request.env,
      data: event.request.data,
      extra: event.extra,
      contexts: event.contexts,
      tags: event.tags,
    });
    for (const ip of ['127.0.0.1', '::1', '::ffff:', '203.0.113.9'])
      assert.ok(!clientFields.includes(ip), `no client IP literal ${ip}`);
    assert.ok(!/203\.0\.113\./.test(request.body));
  });

  it('keeps 50 concurrent requests isolated', async () => {
    await Promise.all(Array.from({ length: 50 }, (_, i) => fetch(`${appUrl}/slow/${i}`)));
    await Beacon.flush(5000);
    const captured = events(ctx.mock).map(({ event }) => event);
    assert.equal(captured.length, 25);
    for (const event of captured) {
      const id = event.exception.values.at(-1).value.replace('odd ', '');
      assert.equal(event.tags.request_id, id);
      const crumbs = event.breadcrumbs.values
        .filter((b) => b.category === 'app')
        .map((b) => b.message);
      assert.deepEqual(crumbs, [`slow ${id}`]);
    }
  });

  it('gzips bodies over 1 kB', async () => {
    await fetch(`${appUrl}/big`);
    await Beacon.flush(2000);
    const [{ request }] = events(ctx.mock);
    assert.equal(request.headers['content-encoding'], 'gzip');
    assert.ok(request.wireBytes < Buffer.byteLength(request.body));
  });

  it('a 429 with Retry-After blocks the whole transport for N seconds', async () => {
    ctx.mock.script({
      status: 429,
      headers: { 'Retry-After': '2', 'X-Beacon-Rate-Limit': 'project' },
    });
    Beacon.captureMessage('first');
    await Beacon.flush(2000);
    const started = Date.now();
    Beacon.captureMessage('second');
    await Beacon.flush(500);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(ctx.mock.requests.length, 1, 'no request before Retry-After');
    await waitFor(() => ctx.mock.requests.length >= 3, 10_000);
    assert.ok(ctx.mock.requests[1].time - started >= 1900, 'retried after the deadline');
    assert.equal(Beacon.getClient().lastRateLimit, 'project');
  });

  it('refuses a browser key', () => {
    assert.throws(
      () =>
        Beacon.init({
          dsn: 'https://bk_test_0000000000000000@beacon.test/00000000-0000-4000-8000-000000000001',
        }),
      /Invalid Beacon DSN/,
    );
  });
});
