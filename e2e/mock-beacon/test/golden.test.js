// @ts-check
// Conformance: every golden envelope passes the mock server's Beacon rules (contract §11.5, acceptance 14).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMockBeacon, parseEnvelope } from '../src/server.js';
import { send } from './helpers.js';

const dir = new URL('../../../fixtures/envelopes/golden/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const placeholders = index.placeholders;
const mock = createMockBeacon({
  projectId: placeholders.project,
  serverKeys: [{ public: placeholders.server_key, secret: placeholders.server_secret }],
  browserKeys: [placeholders.browser_key],
  allowedOrigins: [placeholders.origin],
});
let base = '';

beforeAll(async () => {
  base = await mock.listen();
});
afterAll(() => mock.close());
beforeEach(() => {
  mock.reset();
  mock.configure({ mode: 'current' });
});

const load = (name) => readFileSync(new URL(name, dir));

describe('golden envelopes', () => {
  it('index lists every case with its files and placeholders only', () => {
    expect(index.schema).toBe('nowo.beacon-js.golden/v1');
    expect(index.cases.length).toBeGreaterThanOrEqual(18);
    for (const goldenCase of index.cases) {
      const text =
        load(goldenCase.envelope).toString('latin1') + load(goldenCase.request).toString('utf8');
      expect(text).not.toMatch(/beacon\.example|test-secret|203\.0\.113/);
    }
  });

  for (const goldenCase of index.cases) {
    it(`${goldenCase.name} passes the current Beacon rules`, async () => {
      const request = JSON.parse(load(goldenCase.request).toString('utf8'));
      const expected = JSON.parse(load(goldenCase.expected).toString('utf8'));
      const body = load(goldenCase.envelope);
      const response = await send(base, {
        path: request.path.replace('{projectId}', request.project_id),
        headers: request.headers,
        body,
      });
      expect(response.status).toBe(expected.status);
      if (request.headers.Origin && response.status !== 403) {
        expect(response.headers['access-control-allow-origin']).toBe(request.headers.Origin);
        expect(response.headers['access-control-expose-headers']).toBe(
          'Retry-After, X-Beacon-Rate-Limit',
        );
      } else {
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
      }
      if (expected.items) {
        expect({
          accepted: mock.stats.events,
          counted: mock.stats.clientReports,
          dropped: mock.stats.dropped,
        }).toEqual(expected.items);
      }
      if (expected.event) {
        const event = mock.requests[0].envelope.items[0].payload;
        expect(event.platform).toBe(expected.event.platform);
        expect(event.level).toBe(expected.event.level);
      }
    });

    it(`${goldenCase.name} frames identically with the legacy newline rule`, () => {
      let body = load(goldenCase.envelope);
      if (goldenCase.envelope.endsWith('.gz')) body = gunzipSync(body);
      const current = parseEnvelope(body, { lengthFraming: true, strictLength: true });
      const legacy = parseEnvelope(body, { lengthFraming: false, strictLength: true });
      expect(legacy.items.map((item) => item.raw)).toEqual(current.items.map((item) => item.raw));
      for (const item of current.items) {
        expect(Buffer.byteLength(item.raw)).toBe(item.header.length);
        expect(item.raw).not.toContain('\n');
        expect(typeof item.payload).toBe('object');
      }
    });
  }

  it('server-key cases without spec 172 requirements pass a legacy Beacon', async () => {
    mock.configure({ mode: 'legacy' });
    for (const goldenCase of index.cases.filter((c) => c.requires.length === 0)) {
      const request = JSON.parse(load(goldenCase.request).toString('utf8'));
      const expected = JSON.parse(load(goldenCase.expected).toString('utf8'));
      const response = await send(base, {
        path: request.path.replace('{projectId}', request.project_id),
        headers: request.headers,
        body: load(goldenCase.envelope),
      });
      expect(response.status, goldenCase.name).toBe(expected.status);
    }
  });

  it('the express case carries a scrubbed request without client IPs', () => {
    const body = load('node-event-express.envelope').toString('utf8');
    const event = JSON.parse(body.split('\n')[2]);
    expect(event.request.headers.authorization).toBe('[Filtered]');
    expect(event.request.headers.cookie).toBe('[Filtered]');
    expect(event.request.headers['x-forwarded-for']).toBeUndefined();
    expect(event.request.url).toBe('https://shop.test/users/42?token=[Filtered]&page=2');
    expect(body).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });
});
