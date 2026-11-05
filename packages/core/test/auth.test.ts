import { describe, expect, it } from 'vitest';
import {
  beaconServerAuth,
  envelopeDsnAuth,
  headerBrowserKeyAuth,
  serverEnvelopeDsnAuth,
} from '../src/auth.js';
import { defaultDsnParser } from '../src/dsn.js';
import { BROWSER_DSN, SERVER_DSN } from './helpers.js';

const server = defaultDsnParser.parse(SERVER_DSN);
const browser = defaultDsnParser.parse(BROWSER_DSN);
const noSecret = defaultDsnParser.parse(
  'https://test-public@beacon.test/00000000-0000-4000-8000-000000000001',
);

describe('auth providers', () => {
  it('beaconServerAuth sends X-Beacon-Auth and no envelope dsn', () => {
    const auth = beaconServerAuth();
    expect(auth.headers(server)).toEqual({
      'X-Beacon-Auth': 'Beacon beacon_key=test-public, beacon_secret=test-secret-not-real',
    });
    expect(auth.envelopeHeader).toBeUndefined();
    expect(auth.supportsHeaderless).toBe(false);
    expect(() => auth.headers(noSecret)).toThrow(/needs a secret/);
  });

  it('envelopeDsnAuth puts the public DSN in the header line only', () => {
    const auth = envelopeDsnAuth();
    expect(auth.headers(browser)).toEqual({});
    expect(auth.envelopeHeader!(browser)).toEqual({ dsn: BROWSER_DSN });
    expect(auth.supportsHeaderless).toBe(true);
  });

  it('headerBrowserKeyAuth uses the header', () => {
    const auth = headerBrowserKeyAuth();
    expect(auth.headers(browser)).toEqual({
      'X-Beacon-Auth': 'Beacon beacon_key=bk_test_0000000000000000',
    });
    expect(auth.supportsHeaderless).toBe(false);
  });

  it('serverEnvelopeDsnAuth puts the full DSN in the header line', () => {
    const auth = serverEnvelopeDsnAuth();
    expect(auth.headers(server)).toEqual({});
    expect(auth.envelopeHeader!(server)).toEqual({ dsn: SERVER_DSN });
    expect(() => auth.headers(noSecret)).toThrow(/needs a secret/);
    expect(auth.name).toBe('serverEnvelopeDsnAuth');
  });

  it('never puts credentials in the URL', () => {
    for (const dsn of [server, browser]) {
      for (const url of [dsn.envelopeUrl(), dsn.otlpUrl('traces')]) {
        expect(url).not.toMatch(/beacon_key|beacon_secret|sentry_key|bk_|test-secret/);
      }
    }
  });
});
