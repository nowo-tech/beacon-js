import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, type ClientOptions } from '../src/client.js';
import { defaultDsnParser, type DsnParser } from '../src/dsn.js';
import {
  forgetIngestPath,
  INGEST_PATH_CACHE_SIZE,
  knownIngestPath,
  provesRoute,
  rememberIngestPath,
  resetIngestPaths,
} from '../src/ingest-paths.js';
import { makeMemoryQueue } from '../src/queue.js';
import { Scope } from '../src/scope.js';
import type { TransportResult } from '../src/transport.js';
import { BROWSER_DSN, platform, recordingTransport, SERVER_DSN } from './helpers.js';

const PROJECT = '00000000-0000-4000-8000-000000000001';
const VERSIONED = `https://beacon.test/api/ingest/v1/${PROJECT}/envelope/`;
const LEGACY = `https://beacon.test/api/${PROJECT}/envelope/`;
const TARGET = LEGACY;

const missing = (status: number): TransportResult => ({ kind: 'drop', reason: 'client', status });
const network: TransportResult = { kind: 'retry', afterMs: 0, reason: 'network' };

function make(
  options: Partial<ClientOptions> = {},
  overrides: Parameters<typeof platform>[0] = {},
  ...results: TransportResult[]
) {
  const transport = recordingTransport(...results);
  const client = new Client(
    { dsn: BROWSER_DSN, transport, random: () => 0, queue: false, ...options },
    platform(overrides),
  ).setup();
  return { client, transport, urls: () => transport.requests.map((r) => r.url) };
}

async function send(client: Client): Promise<void> {
  client.captureMessage('hello', new Scope());
  await client.flush(10_000);
}

beforeEach(() => resetIngestPaths());
afterEach(() => vi.restoreAllMocks());

describe('route proof', () => {
  it('only a 2xx or a Beacon 4xx proves a route', () => {
    for (const status of [200, 202, 204, 299, 400, 401, 403, 413, 415, 422])
      expect(provesRoute(status)).toBe(true);
    for (const status of [199, 300, 307, 402, 404, 405, 408, 409, 410, 429, 500, 502, 503, 504])
      expect(provesRoute(status)).toBe(false);
  });
});

describe('ingest path cache', () => {
  it('is bounded and evicts the oldest origin', () => {
    for (let i = 0; i <= INGEST_PATH_CACHE_SIZE; i++)
      rememberIngestPath(`https://b${i}.test`, 'legacy');
    expect(knownIngestPath('https://b0.test')).toBeUndefined();
    expect(knownIngestPath('https://b1.test')).toBe('legacy');
    rememberIngestPath('https://b1.test', 'versioned');
    rememberIngestPath('https://new.test', 'legacy');
    expect(knownIngestPath('https://b1.test')).toBe('versioned');
    expect(knownIngestPath('https://b2.test')).toBeUndefined();
    resetIngestPaths();
    expect(knownIngestPath('https://b1.test')).toBeUndefined();
  });
});

describe('ingest paths (auto)', () => {
  it('sends to the versioned path and remembers it', async () => {
    const { client, urls } = make();
    await send(client);
    await send(client);
    expect(urls()).toEqual([VERSIONED, VERSIONED]);
    expect(knownIngestPath(TARGET)).toBe('versioned');
  });

  it.each([404, 405])(
    'falls back once on %i, then goes straight to the legacy path',
    async (status) => {
      const outcomes: unknown[] = [];
      const { client, urls } = make({ onOutcome: (o) => outcomes.push(o) }, {}, missing(status));
      await send(client);
      expect(urls()).toEqual([VERSIONED, LEGACY]);
      expect(knownIngestPath(TARGET)).toBe('legacy');
      expect(outcomes).toEqual([{ type: 'captured', eventId: expect.any(String) }]);
      await send(client);
      expect(urls()).toEqual([VERSIONED, LEGACY, LEGACY]);
    },
  );

  it('shares what it learnt with another client for the same Beacon project', async () => {
    await send(make({}, {}, missing(404)).client);
    const second = make({ dsn: SERVER_DSN });
    await send(second.client);
    expect(second.urls()).toEqual([LEGACY]);
  });

  it.each([400, 401, 403, 413, 415, 422, 408, 429, 500, 502, 503, 504])(
    'never falls back on %i, and learns only from a Beacon answer',
    async (status) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result: TransportResult =
        status === 429 || status >= 500
          ? { kind: 'retry', afterMs: 0, reason: 'unavailable', status }
          : missing(status);
      const { client, urls } = make({}, {}, result);
      await send(client);
      expect(urls()).toEqual([VERSIONED]);
      // LO-M1: 408 / 429 / 5xx can come from a proxy or an outage in front of an older Beacon.
      expect(knownIngestPath(TARGET)).toBe(provesRoute(status) ? 'versioned' : undefined);
    },
  );

  it('audit PoC: a 503 on the first probe, then an old Beacon, is delivered through the alias', async () => {
    const unavailable: TransportResult = {
      kind: 'retry',
      afterMs: 0,
      reason: 'unavailable',
      status: 503,
    };
    const { client, urls } = make({}, {}, unavailable, missing(404));
    await send(client);
    await send(client);
    await send(client);
    expect(urls()).toEqual([VERSIONED, VERSIONED, LEGACY, LEGACY]);
    expect(knownIngestPath(TARGET)).toBe('legacy');
  });

  it('audit PoC: a 404 on a target known as versioned self-heals through the alias', async () => {
    rememberIngestPath(TARGET, 'versioned');
    const { client, urls } = make({}, {}, missing(404));
    await send(client);
    await send(client);
    expect(urls()).toEqual([VERSIONED, LEGACY, LEGACY]);
    expect(knownIngestPath(TARGET)).toBe('legacy');
  });

  it('learns nothing from a transient answer of the alias', async () => {
    const unavailable: TransportResult = {
      kind: 'retry',
      afterMs: 0,
      reason: 'unavailable',
      status: 502,
    };
    const { client, urls } = make({}, {}, missing(404), unavailable);
    await send(client);
    expect(urls()).toEqual([VERSIONED, LEGACY]);
    expect(knownIngestPath(TARGET)).toBeUndefined();
  });

  it('a newer answer replaces an older one', () => {
    rememberIngestPath(TARGET, 'legacy');
    rememberIngestPath(TARGET, 'versioned');
    expect(knownIngestPath(TARGET)).toBe('versioned');
    forgetIngestPath(TARGET);
    expect(knownIngestPath(TARGET)).toBeUndefined();
  });

  it('remembers the versioned path when both paths answer 404', async () => {
    const { client, urls } = make({}, {}, missing(404), missing(404));
    await send(client);
    expect(urls()).toEqual([VERSIONED, LEGACY]);
    expect(knownIngestPath(TARGET)).toBe('versioned');
  });

  it('browser: tries the legacy path after an opaque failure (no CORS on an old 404)', async () => {
    const { client, urls } = make({}, {}, network);
    await send(client);
    expect(urls()).toEqual([VERSIONED, LEGACY]);
    expect(knownIngestPath(TARGET)).toBe('legacy');
  });

  it('browser: re-sends an opaque failure at most once per target (LO-L2)', async () => {
    // A current Beacon's IP-limiter 429 or BrowserIngestGate 401 / 403 carry no CORS headers either.
    const { client, urls } = make({}, {}, network, network, network);
    await send(client);
    expect(urls()).toEqual([VERSIONED, LEGACY]);
    expect(knownIngestPath(TARGET)).toBe('opaque');
    await send(client);
    expect(urls()).toEqual([VERSIONED, LEGACY, VERSIONED]);
  });

  it('browser: after an opaque failure, a visible answer still decides', async () => {
    rememberIngestPath(TARGET, 'opaque');
    const { client, urls } = make({}, {}, missing(404));
    await send(client);
    expect(urls()).toEqual([VERSIONED, LEGACY]);
    expect(knownIngestPath(TARGET)).toBe('legacy');

    rememberIngestPath(TARGET, 'opaque');
    await send(client);
    expect(knownIngestPath(TARGET)).toBe('versioned');
  });

  it('browser: never re-sends after a timeout (the first request may have been accepted)', async () => {
    const timeout: TransportResult = {
      kind: 'retry',
      afterMs: 0,
      reason: 'network',
      timedOut: true,
    };
    const { client, urls } = make({}, {}, timeout);
    await send(client);
    expect(urls()).toEqual([VERSIONED]);
    expect(knownIngestPath(TARGET)).toBeUndefined();
  });

  it('browser: a drop without a status (opaque redirect) is final', async () => {
    const { client, urls } = make({}, {}, { kind: 'drop', reason: 'client' });
    await send(client);
    expect(urls()).toEqual([VERSIONED]);
    expect(knownIngestPath(TARGET)).toBeUndefined();
  });

  it('node: a network failure is not a missing route', async () => {
    const { client, urls } = make({ dsn: SERVER_DSN }, { platform: 'node' }, network);
    await send(client);
    expect(urls()).toEqual([VERSIONED]);
    expect(knownIngestPath(TARGET)).toBeUndefined();
  });

  it('uses the legacy path for unload requests until the origin is known', async () => {
    const queue = makeMemoryQueue();
    const { client, urls } = make({ queue });
    const queued = (id: string) => ({
      id,
      createdAt: Date.now(),
      category: 'error' as const,
      eventId: id,
      header: { event_id: id },
      items: [{ type: 'event', payload: '{}' }],
    });
    await queue.push(queued('a'));
    expect(await client.flush(1000, true)).toBe(true);
    rememberIngestPath(TARGET, 'opaque');
    await queue.push(queued('c'));
    expect(await client.flush(1000, true)).toBe(true);
    rememberIngestPath(TARGET, 'versioned');
    await queue.push(queued('b'));
    expect(await client.flush(1000, true)).toBe(true);
    expect(urls()).toEqual([LEGACY, LEGACY, VERSIONED]);
  });
});

describe('ingest paths (forced)', () => {
  it('versioned never falls back', async () => {
    const { client, urls } = make({ ingestPaths: 'versioned' }, {}, missing(404));
    await send(client);
    expect(urls()).toEqual([VERSIONED]);
    expect(knownIngestPath(TARGET)).toBeUndefined();
  });

  it('legacy always uses the unversioned alias', async () => {
    const { client, urls } = make({ ingestPaths: 'legacy' }, {}, missing(404));
    await send(client);
    expect(urls()).toEqual([LEGACY]);
  });

  it('a custom parser without legacy URLs never falls back', async () => {
    const parser: DsnParser = {
      parse(dsn) {
        const parsed = defaultDsnParser.parse(dsn);
        delete parsed.legacyEnvelopeUrl;
        return parsed;
      },
    };
    const { client, urls } = make({ dsnParser: parser }, {}, missing(404));
    await send(client);
    expect(urls()).toEqual([VERSIONED]);
  });
});
