// @ts-check
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockBeacon, parseBeaconAuth, parseEnvelope, PROJECT_ID } from '../src/server.js';
import { send } from './helpers.js';

const ORIGIN = 'https://app.test';
const mock = createMockBeacon({ allowedOrigins: [ORIGIN] });
let base = '';
const path = `/api/${PROJECT_ID}/envelope/`;
const browserDsn = `https://bk_test_0000000000000000@beacon.test/${PROJECT_ID}`;
const envelope = (header, ...items) =>
  [
    JSON.stringify(header),
    ...items.flatMap(([type, payload]) => [
      JSON.stringify({ type, length: Buffer.byteLength(payload) }),
      payload,
    ]),
  ].join('\n');
const eventBody = envelope({ dsn: browserDsn }, ['event', '{"message":"x"}']);
const serverHeaders = {
  'X-Beacon-Auth': 'Beacon beacon_key=test-public, beacon_secret=test-secret-not-real',
};

beforeAll(async () => {
  base = await mock.listen();
});
afterAll(() => mock.close());
beforeEach(() => {
  mock.reset();
  mock.configure({ mode: 'current', rules: { rateLimits: true } });
});

describe('mock Beacon', () => {
  it('parses X-Beacon-Auth like EnvelopeAuthParser', () => {
    expect(parseBeaconAuth('Beacon beacon_key=a , beacon_secret=b')).toEqual({
      beacon_key: 'a',
      beacon_secret: 'b',
    });
    expect(parseBeaconAuth('Sentry sentry_key=a')).toEqual({});
    expect(parseBeaconAuth(undefined)).toEqual({});
  });

  it('honours length framing with a newline fallback and refuses non-object headers', () => {
    const body = Buffer.from(
      '{}\n{"type":"event","length":5}\n{"a":1}\n{"type":"event"}\n{"b":2}\n\n{"type":"x"}\n',
    );
    expect(() => parseEnvelope(body, { lengthFraming: true, strictLength: true })).toThrow();
    const ok = Buffer.from(
      '{}\n{"type":"event","length":7}\n{"a":1}\n{"type":"event"}\n{"b":2}\n\n{"type":"x"}\n',
    );
    expect(
      parseEnvelope(ok, { lengthFraming: true, strictLength: true }).items.map((i) => i.payload),
    ).toEqual([{ a: 1 }, { b: 2 }, '']);
    expect(() =>
      parseEnvelope(Buffer.from('[]\n'), { lengthFraming: true, strictLength: true }),
    ).toThrow();
    expect(() =>
      parseEnvelope(Buffer.from('{}\nnot json\n'), { lengthFraming: true, strictLength: true }),
    ).toThrow();
  });

  it('answers the preflight for allowed origins only, exactly', async () => {
    const allowed = await send(base, { method: 'OPTIONS', path, headers: { Origin: ORIGIN } });
    expect(allowed.status).toBe(204);
    expect(allowed.headers).toMatchObject({
      'access-control-allow-origin': ORIGIN,
      vary: 'Origin',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Content-Encoding, X-Beacon-Auth',
      'access-control-max-age': '600',
    });
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
    const refused = await send(base, {
      method: 'OPTIONS',
      path,
      headers: { Origin: 'https://evil.test' },
    });
    expect(refused.status).toBe(403);
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('accepts a browser key in the envelope dsn from an allowed origin, refuses others', async () => {
    expect(
      (
        await send(base, {
          path,
          headers: { Origin: ORIGIN, 'Content-Type': 'text/plain;charset=UTF-8' },
          body: eventBody,
        })
      ).status,
    ).toBe(200);
    expect(
      (await send(base, { path, headers: { Origin: 'https://evil.test' }, body: eventBody }))
        .status,
    ).toBe(403);
    expect((await send(base, { path, body: eventBody })).status).toBe(403);
    const withSecret = envelope(
      { dsn: browserDsn.replace('bk_test_0000000000000000', 'bk_test_0000000000000000:s') },
      ['event', '{}'],
    );
    expect((await send(base, { path, headers: { Origin: ORIGIN }, body: withSecret })).status).toBe(
      401,
    );
    expect(
      (
        await send(base, {
          path: path.replace(PROJECT_ID, '00000000-0000-4000-8000-000000000999'),
          headers: { Origin: ORIGIN },
          body: eventBody,
        })
      ).status,
    ).toBe(401);
    expect(mock.stats.events).toBe(1);
  });

  it('counts client_report, drops other browser items, caps at 200 kB', async () => {
    const mixed = envelope(
      { dsn: browserDsn },
      ['client_report', '{"discarded_events":[]}'],
      ['attachment', '{}'],
      ['event', '"not an object"'],
    );
    expect((await send(base, { path, headers: { Origin: ORIGIN }, body: mixed })).status).toBe(200);
    expect(mock.stats).toMatchObject({ clientReports: 1, dropped: 2 });
    const big = envelope({ dsn: browserDsn }, [
      'event',
      JSON.stringify({ message: 'x'.repeat(210 * 1024) }),
    ]);
    expect((await send(base, { path, headers: { Origin: ORIGIN }, body: big })).status).toBe(413);
  });

  it('decodes gzip and refuses ratios over 50:1', async () => {
    const body = envelope({}, [
      'event',
      JSON.stringify({ message: Array.from({ length: 500 }, (_, i) => `${i * 7919}`).join(',') }),
    ]);
    expect(
      (
        await send(base, {
          path,
          headers: { ...serverHeaders, 'Content-Encoding': 'gzip' },
          body: gzipSync(body),
        })
      ).status,
    ).toBe(200);
    const repetitive = envelope({}, ['event', JSON.stringify({ message: 'a'.repeat(100_000) })]);
    expect(
      (
        await send(base, {
          path,
          headers: { ...serverHeaders, 'Content-Encoding': 'gzip' },
          body: gzipSync(repetitive),
        })
      ).status,
    ).toBe(413);
    expect(
      (await send(base, { path, headers: { ...serverHeaders, 'Content-Encoding': 'br' }, body }))
        .status,
    ).toBe(400);
    expect(
      (
        await send(base, {
          path,
          headers: { ...serverHeaders, 'Content-Encoding': 'gzip' },
          body: 'not gzip',
        })
      ).status,
    ).toBe(413);
  });

  it('refuses query credentials, bad server auth, empty and invalid bodies', async () => {
    expect(
      (
        await send(base, {
          path: `${path}?beacon_key=test-public`,
          headers: serverHeaders,
          body: eventBody,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await send(base, {
          path,
          headers: { 'X-Beacon-Auth': 'Beacon beacon_key=test-public, beacon_secret=wrong' },
          body: '{}\n',
        })
      ).status,
    ).toBe(401);
    expect((await send(base, { path, headers: serverHeaders, body: '' })).status).toBe(400);
    expect((await send(base, { path, headers: serverHeaders, body: 'nope' })).status).toBe(400);
    expect((await send(base, { method: 'GET', path })).status).toBe(405);
    expect((await send(base, { path: '/other' })).status).toBe(404);
  });

  it('plays scripted responses with CORS and applies the per-IP limit', async () => {
    mock.script({ status: 429, headers: { 'Retry-After': '3', 'X-Beacon-Rate-Limit': 'key' } });
    const limited = await send(base, { path, headers: { Origin: ORIGIN }, body: eventBody });
    expect(limited.status).toBe(429);
    expect(limited.headers).toMatchObject({
      'retry-after': '3',
      'x-beacon-rate-limit': 'key',
      'access-control-allow-origin': ORIGIN,
    });
    mock.configure({ limits: { perIp: 2 } });
    await send(base, { path, headers: { Origin: ORIGIN }, body: eventBody });
    await send(base, { path, headers: { Origin: ORIGIN }, body: eventBody });
    const third = await send(base, { path, headers: { Origin: ORIGIN }, body: eventBody });
    expect(third.status).toBe(429);
    expect(third.headers['x-beacon-rate-limit']).toBe('ip');
    mock.configure({ limits: { perIp: 60 } });
  });

  it('legacy mode: no CORS, no gzip, newline framing, no browser keys', async () => {
    mock.configure({ mode: 'legacy' });
    const response = await send(base, { path, headers: { Origin: ORIGIN }, body: eventBody });
    expect(response.status).toBe(401);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(
      (await send(base, { path, headers: serverHeaders, body: envelope({}, ['event', '{"a":1}']) }))
        .status,
    ).toBe(200);
    expect(
      (
        await send(base, {
          path,
          headers: { ...serverHeaders, 'Content-Encoding': 'gzip' },
          body: gzipSync('{}'),
        })
      ).status,
    ).toBe(400);
  });

  it('exposes control endpoints', async () => {
    await send(base, { path, headers: serverHeaders, body: envelope({}, ['event', '{}']) });
    const listed = JSON.parse((await send(base, { method: 'GET', path: '/__requests' })).body);
    expect(listed).toHaveLength(1);
    expect(
      JSON.parse(
        (await send(base, { path: '/__script', body: JSON.stringify([{ status: 503 }]) })).body,
      ),
    ).toEqual({ queued: 1 });
    expect((await send(base, { path, headers: serverHeaders, body: '{}' })).status).toBe(503);
    expect(
      JSON.parse(
        (await send(base, { path: '/__config', body: JSON.stringify({ limits: { perIp: 60 } }) }))
          .body,
      ).limits.perIp,
    ).toBe(60);
    expect(JSON.parse((await send(base, { method: 'GET', path: '/__stats' })).body)).toHaveProperty(
      'events',
    );
    expect((await send(base, { method: 'DELETE', path: '/__requests' })).status).toBe(200);
    expect(mock.requests).toHaveLength(0);
    expect((await send(base, { method: 'GET', path: '/__nope' })).status).toBe(404);
  });
});
