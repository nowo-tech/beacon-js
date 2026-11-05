import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beaconServerAuth } from '../src/auth.js';
import { Client, type ClientOptions, type Integration } from '../src/client.js';
import { makeMemoryQueue } from '../src/queue.js';
import { Scope } from '../src/scope.js';
import type { TransportResult } from '../src/transport.js';
import {
  BROWSER_DSN,
  eventOf,
  parseEnvelope,
  platform,
  recordingTransport,
  SERVER_DSN,
  type RecordingTransport,
} from './helpers.js';

let now = 1_000_000;
const clock = () => now;

function make(
  options: Partial<ClientOptions> = {},
  overrides: Parameters<typeof platform>[0] = {},
  ...results: TransportResult[]
) {
  const transport = recordingTransport(...results);
  const client = new Client(
    { dsn: BROWSER_DSN, transport, clock, random: () => 0, ...options },
    platform(overrides),
  ).setup();
  return { client, transport };
}

const error = (message = 'boom') => {
  const e = new TypeError(message);
  e.stack = `TypeError: ${message}\n    at handler (https://app.test/assets/app-0123abcd.js:1:2)`;
  return e;
};

async function settle(client: Client): Promise<void> {
  await client.flush(10_000);
}

const reports = (transport: RecordingTransport) =>
  transport.requests.filter((r) => r.category === 'internal').map((r) => parseEnvelope(r.body));

beforeEach(() => {
  now = 1_000_000;
  vi.useFakeTimers({ now });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Client configuration', () => {
  it('warns and stays disabled on a bad DSN (browser)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client, transport } = make({ dsn: 'nope' });
    expect(client.isActive()).toBe(false);
    expect(client.captureException(error(), new Scope())).toMatch(/^[0-9a-f]{32}$/);
    expect(transport.requests).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid Beacon DSN: not a URL'));
  });

  it('refuses a DSN the platform rejects, and throws on Node-like platforms', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(make({}, { validateDsn: () => 'browser keys are refused' }).client.isActive()).toBe(
      false,
    );
    expect(() =>
      make(
        { dsn: SERVER_DSN.replace(':test-secret-not-real', '') },
        { defaultAuth: beaconServerAuth, onConfigError: 'throw' },
      ),
    ).toThrow(/needs a secret/);
  });

  it('creates the platform transport and queue when none is given', () => {
    const transport = recordingTransport();
    const queue = makeMemoryQueue();
    const client = new Client(
      { dsn: BROWSER_DSN },
      platform({ makeTransport: () => transport, defaultQueue: () => queue }),
    );
    expect(client.isActive()).toBe(true);
    expect(new Client({ dsn: BROWSER_DSN, enabled: false }, platform()).setup().isActive()).toBe(
      false,
    );
  });

  it('clamps the envelope cap on lower-only platforms', () => {
    expect(make({ maxEnvelopeBytes: 500_000 }).client.maxEnvelopeBytes).toBe(200_000);
    expect(make({ maxEnvelopeBytes: 1000 }).client.maxEnvelopeBytes).toBe(1000);
    expect(make({ maxEnvelopeBytes: 500_000 }, { lowerOnly: false }).client.maxEnvelopeBytes).toBe(
      500_000,
    );
    expect(make({ maxEnvelopeBytes: 0 }).client.maxEnvelopeBytes).toBe(200_000);
  });

  it('logs only in debug mode and warns about a disabled scrubber', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    make({ scrubber: false });
    expect(warn).not.toHaveBeenCalled();
    make({ scrubber: false, debug: true });
    expect(warn).toHaveBeenCalledWith('[beacon] the default scrubber is disabled');
  });

  it('accepts integrations as a list or a function', () => {
    const a: Integration = { name: 'A', setup: vi.fn() };
    const b: Integration = { name: 'B' };
    expect(make({ integrations: [b] }, { defaultIntegrations: [a] }).client.integrations).toEqual([
      b,
    ]);
    expect(
      make({ integrations: (d) => [...d, b] }, { defaultIntegrations: [a] }).client.integrations,
    ).toEqual([a, b]);
    expect(a.setup).toHaveBeenCalledTimes(1);
  });
});

describe('Client capture pipeline', () => {
  it('sends a Sentry-ordered exception event with the envelope dsn', async () => {
    const { client, transport } = make(
      { release: 'shop@1.0.0', dist: 'web', serverName: 'srv' },
      { defaultIntegrations: [{ name: 'GlobalHandlers' }] },
    );
    const scope = new Scope().setTag('t', 'v');
    const id = client.captureException(
      error(),
      scope,
      { extra: { k: 1 } },
      { logger: 'window.onerror', mechanism: { type: 'onerror', handled: false } },
    );
    await settle(client);
    expect(transport.requests).toHaveLength(1);
    const request = transport.requests[0]!;
    expect(request.url).toBe(
      'https://beacon.test/api/00000000-0000-4000-8000-000000000001/envelope/',
    );
    expect(request.eventId).toBe(id);
    expect(request.headers).toEqual({});
    const envelope = parseEnvelope(request.body);
    expect(envelope.header).toEqual({
      event_id: id,
      sdk: { name: 'nowo.javascript.test', version: '0.0.0-test' },
      dsn: BROWSER_DSN,
      sent_at: new Date(now).toISOString(),
    });
    expect(envelope.items[0]!.header).toEqual({
      type: 'event',
      length: new TextEncoder().encode(request.body.split('\n')[2]!).length,
    });
    expect(envelope.items[0]!.payload).toMatchObject({
      event_id: id,
      timestamp: now / 1000,
      platform: 'javascript',
      level: 'error',
      logger: 'window.onerror',
      release: 'shop@1.0.0',
      dist: 'web',
      server_name: 'srv',
      environment: 'production',
      tags: { t: 'v' },
      extra: { k: 1 },
      sdk: {
        name: 'nowo.javascript.test',
        version: '0.0.0-test',
        integrations: ['GlobalHandlers'],
      },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'boom',
            mechanism: { type: 'onerror', handled: false },
            stacktrace: { frames: [{ filename: '/assets/app.js', in_app: true }] },
          },
        ],
      },
    });
  });

  it('captures messages and non-Error values', async () => {
    const { client, transport } = make({ environment: 'staging' });
    client.captureMessage('hello', new Scope());
    client.captureMessage('warn', new Scope(), 'warning');
    client.captureException({ odd: true }, new Scope());
    await settle(client);
    expect(eventOf(transport.requests[0]!)).toMatchObject({
      message: 'hello',
      level: 'info',
      environment: 'staging',
    });
    expect(eventOf(transport.requests[1]!)).toMatchObject({ message: 'warn', level: 'warning' });
    expect(eventOf(transport.requests[2]!)).toMatchObject({
      extra: { __serialized__: { odd: true } },
      exception: { values: [{ mechanism: { type: 'generic', handled: true } }] },
    });
  });

  it('keeps an explicit event id', () => {
    const { client } = make();
    expect(client.captureEvent({ event_id: 'f'.repeat(32) }, new Scope())).toBe('f'.repeat(32));
    expect(
      make({ generateEventId: () => 'a'.repeat(32) }).client.captureMessage('x', new Scope()),
    ).toBe('a'.repeat(32));
  });

  it('samples, filters and lets beforeSend drop, counting each discard', async () => {
    const processor: Integration = {
      name: 'P',
      processEvent: (event) => (event.message === 'drop-me' ? null : event),
    };
    const { client, transport } = make({
      integrations: [processor, { name: 'NoProcessor' }],
      ignoreErrors: ['ignored', /^Regex/],
      denyUrls: [/deny\.test/],
      beforeSend: (event) => (event.message === 'before' ? null : event),
    });
    const scope = new Scope();
    client.captureMessage('drop-me', scope);
    client.captureMessage('this is ignored', scope);
    client.captureMessage('Regex match', scope);
    client.captureMessage('before', scope);
    const scriptError = new Error('Script error.');
    scriptError.stack = 'Error: Script error.';
    client.captureException(scriptError, scope);
    const denied = new Error('x');
    denied.stack = 'Error: x\n    at f (https://deny.test/a.js:1:1)';
    client.captureException(denied, scope);
    client.captureMessage('kept', scope);
    await settle(client);
    expect(transport.requests.map((r) => eventOf(r)['message'])).toEqual(['kept']);
    await vi.advanceTimersByTimeAsync(60_000);
    await settle(client);
    const [report] = reports(transport);
    expect(report!.header).toEqual({
      sdk: { name: 'nowo.javascript.test', version: '0.0.0-test' },
      dsn: BROWSER_DSN,
      sent_at: expect.any(String),
    });
    expect(report!.items[0]!.header['type']).toBe('client_report');
    expect(report!.items[0]!.payload['discarded_events']).toEqual([
      { reason: 'event_processor', category: 'error', quantity: 5 },
      { reason: 'before_send', category: 'error', quantity: 1 },
    ]);
  });

  it('applies sampleRate and allowUrls', async () => {
    const sampled = make({ sampleRate: 0 });
    sampled.client.captureMessage('x', new Scope());
    await settle(sampled.client);
    expect(sampled.transport.requests).toHaveLength(0);
    const kept = make({ sampleRate: 0.5, random: () => 0.1, allowUrls: ['app.test'] });
    kept.client.captureException(error(), new Scope());
    const other = new Error('x');
    other.stack = 'Error: x\n    at f (https://other.test/a.js:1:1)';
    kept.client.captureException(other, new Scope());
    kept.client.captureMessage('no frames pass allowUrls', new Scope());
    await settle(kept.client);
    expect(kept.transport.requests).toHaveLength(2);
  });

  it('uses default ignoreErrors from the platform', async () => {
    const { client, transport } = make(
      {},
      { defaultIgnoreErrors: ['ResizeObserver loop limit exceeded'] },
    );
    client.captureException(new Error('ResizeObserver loop limit exceeded'), new Scope());
    await settle(client);
    expect(transport.requests).toHaveLength(0);
  });

  it('strips the IP even when beforeSend adds it back, after an async beforeSend', async () => {
    const { client, transport } = make({
      initialScope: {},
      beforeSend: async (event) => ({
        ...event,
        event_id: 'changed',
        user: { ...event.user, ip_address: '{{auto}}' },
        extra: { ip: '{{auto}}' },
      }),
    });
    client.captureMessage('x', new Scope().setUser({ id: '1', ip_address: '203.0.113.9' }));
    await settle(client);
    const event = eventOf(transport.requests[0]!);
    expect(event['event_id']).toBe(transport.requests[0]!.eventId);
    expect(event['user']).toEqual({ id: '1' });
    expect(transport.requests[0]!.body).not.toContain('203.0.113.9');
    expect(transport.requests[0]!.body).not.toContain('{{auto}}');
  });

  it('scrubs with the default scrubber, a custom one, or none', async () => {
    const def = make();
    def.client.captureMessage('x', new Scope().setExtra('password', 'p'));
    await settle(def.client);
    expect(eventOf(def.transport.requests[0]!)['extra']).toEqual({ password: '[Filtered]' });
    const custom = make({ scrubber: (event) => ({ ...event, extra: { custom: true } }) });
    custom.client.captureMessage('x', new Scope());
    await settle(custom.client);
    expect(eventOf(custom.transport.requests[0]!)['extra']).toEqual({ custom: true });
    const none = make({ scrubber: false });
    none.client.captureMessage('x', new Scope().setExtra('password', 'p'));
    await settle(none.client);
    expect(eventOf(none.transport.requests[0]!)['extra']).toEqual({ password: 'p' });
  });

  it('lets the app normalise filenames', async () => {
    const { client, transport } = make({
      normalizeFilename: (frame) => `app:///${frame.function}`,
      inAppInclude: ['vendor'],
      inAppExclude: ['app-'],
    });
    client.captureException(error(), new Scope());
    client.captureMessage('no frames', new Scope());
    const noStack = new Error('n');
    noStack.stack = 'Error: n';
    client.captureException(noStack, new Scope());
    await settle(client);
    expect(
      eventOf(transport.requests[0]!)['exception'].values[0].stacktrace.frames[0],
    ).toMatchObject({ filename: 'app:///handler', in_app: false });
  });

  it('logs processing failures in debug mode', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = make({
      debug: true,
      beforeSend: () => Promise.reject(new Error('bad hook')),
    });
    client.captureMessage('x', new Scope());
    await settle(client);
    expect(warn).toHaveBeenCalledWith('[beacon] event processing failed: Error: bad hook');
  });

  it('drops events that cannot fit the cap', async () => {
    const { client, transport } = make({ maxEnvelopeBytes: 600 });
    client.captureMessage('x'.repeat(5000), new Scope());
    await settle(client);
    expect(transport.requests.filter((r) => r.category === 'error')).toHaveLength(0);
  });
});

describe('Client self-throttle', () => {
  it('drops identical events within the window and counts self_throttle', async () => {
    const { client, transport } = make({}, { identicalWindowMs: 60_000 });
    client.captureMessage('same', new Scope());
    client.captureMessage('same', new Scope());
    await settle(client);
    expect(transport.requests).toHaveLength(1);
    now += 60_001;
    client.captureMessage('same', new Scope());
    await settle(client);
    expect(transport.requests.filter((r) => r.category === 'error')).toHaveLength(2);
  });

  it('caps events per session and the request budget', async () => {
    const session = make({ maxEventsPerSession: 2 });
    for (let i = 0; i < 4; i++) session.client.captureMessage(`m${i}`, new Scope());
    await settle(session.client);
    expect(session.transport.requests).toHaveLength(2);
    const budget = make(
      {},
      { throttle: { perMinute: 1, burst: 1, refillPerSecond: 0 }, maxEventsPerSession: 100 },
    );
    budget.client.captureMessage('a', new Scope());
    budget.client.captureMessage('b', new Scope());
    await settle(budget.client);
    expect(budget.transport.requests).toHaveLength(1);
  });

  it('forgets the oldest identical keys past 100', async () => {
    const { client, transport } = make({}, { identicalWindowMs: 60_000, inFlightCap: 1000 });
    for (let i = 0; i < 102; i++) client.captureMessage(`m${i}`, new Scope());
    await settle(client);
    client.captureMessage('m0', new Scope());
    await settle(client);
    expect(transport.requests).toHaveLength(103);
  });
});

describe('Client transport results', () => {
  it('backs off the whole transport on 429 until Retry-After, then drains the queue in order', async () => {
    const queue = makeMemoryQueue(undefined, clock);
    const { client, transport } = make(
      { queue },
      {},
      { kind: 'retry', afterMs: 7000, reason: 'ratelimit', rateLimit: 'key' },
    );
    const first = client.captureMessage('first', new Scope());
    await settle(client);
    expect(client.lastRateLimit).toBe('key');
    const second = client.captureMessage('second', new Scope());
    await settle(client);
    expect(transport.requests).toHaveLength(1);
    expect(await queue.size()).toBe(2);
    now += 6999;
    await vi.advanceTimersByTimeAsync(6999);
    expect(transport.requests).toHaveLength(1);
    now += 1;
    await vi.advanceTimersByTimeAsync(1);
    await settle(client);
    expect(transport.requests.map((r) => r.eventId)).toEqual([first, first, second]);
    expect(await queue.size()).toBe(0);
  });

  it('drops on backoff without a queue, and counts ratelimit_backoff / network_error', async () => {
    const { client, transport } = make(
      { queue: false },
      {},
      { kind: 'retry', afterMs: 1000, reason: 'quota' },
      { kind: 'retry', afterMs: 0, reason: 'unavailable' },
    );
    client.captureMessage('a', new Scope());
    await settle(client);
    client.captureMessage('b', new Scope());
    await settle(client);
    now += 2000;
    client.captureMessage('c', new Scope());
    await settle(client);
    now += 400_000;
    await vi.advanceTimersByTimeAsync(400_000);
    await settle(client);
    const [report] = reports(transport);
    expect(report!.items[0]!.payload['discarded_events']).toEqual([
      { reason: 'ratelimit_backoff', category: 'error', quantity: 2 },
      { reason: 'network_error', category: 'error', quantity: 1 },
    ]);
  });

  it('re-arms the drain when it runs before the backoff deadline', async () => {
    const queue = makeMemoryQueue(undefined, clock);
    const { client, transport } = make(
      { queue },
      {},
      { kind: 'retry', afterMs: 1000, reason: 'ratelimit' },
    );
    client.captureMessage('a', new Scope());
    await settle(client);
    now += 999;
    await client.drainQueue(false);
    expect(transport.requests).toHaveLength(1);
    now += 1;
    await vi.advanceTimersByTimeAsync(1000);
    await settle(client);
    expect(transport.requests).toHaveLength(2);
    expect(await queue.size()).toBe(0);
  });

  it('stops draining when a queued envelope fails again', async () => {
    const queue = makeMemoryQueue(undefined, clock);
    const { client, transport } = make(
      { queue },
      {},
      { kind: 'retry', afterMs: 10, reason: 'network' },
      { kind: 'retry', afterMs: 10, reason: 'network' },
    );
    client.captureMessage('a', new Scope());
    await settle(client);
    now += 20;
    await client.drainQueue(false);
    expect(transport.requests).toHaveLength(2);
    expect(await queue.size()).toBe(1);
  });

  it('lifts a network wait (never a rate-limit wait) when the browser is back online', async () => {
    const queue = makeMemoryQueue(undefined, clock);
    const { client, transport } = make(
      { queue },
      {},
      { kind: 'retry', afterMs: 60_000, reason: 'network' },
      { kind: 'retry', afterMs: 60_000, reason: 'ratelimit' },
    );
    client.captureMessage('offline', new Scope());
    await settle(client);
    await client.drainQueue(false, true);
    expect(transport.requests).toHaveLength(2);
    await client.drainQueue(false, true);
    expect(transport.requests).toHaveLength(2);
    expect(await queue.size()).toBe(1);
  });

  it('disables itself for 1 h after 3 opaque failures while online', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const network: TransportResult = { kind: 'retry', afterMs: 0, reason: 'network' };
    const { client, transport } = make(
      { queue: false, debug: true },
      { isOnline: () => true },
      network,
      network,
      { kind: 'retry', afterMs: 0, reason: 'ratelimit' },
      network,
      network,
      network,
    );
    for (const m of ['a', 'b', 'c', 'd', 'e', 'f']) {
      client.captureMessage(m, new Scope());
      await settle(client);
      now += 400_000;
    }
    expect(transport.requests).toHaveLength(6);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disabled for 1 h'));
    client.captureMessage('g', new Scope());
    await settle(client);
    expect(transport.requests.filter((r) => r.category === 'error')).toHaveLength(6);
  });

  it('disables itself on 401/403 and never retries in a loop', async () => {
    for (const reason of ['unauthorized', 'forbidden'] as const) {
      const { client, transport } = make({}, {}, { kind: 'drop', reason });
      client.captureMessage('a', new Scope());
      await settle(client);
      client.captureMessage('b', new Scope());
      await settle(client);
      expect(transport.requests).toHaveLength(1);
      now += 3_600_001;
      client.captureMessage('c', new Scope());
      await settle(client);
      expect(transport.requests).toHaveLength(2);
    }
  });

  it('warns about disabling only once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = make(
      { debug: true },
      {},
      { kind: 'drop', reason: 'forbidden' },
      { kind: 'drop', reason: 'forbidden' },
    );
    client.captureMessage('a', new Scope());
    await settle(client);
    now += 3_600_001;
    client.captureMessage('b', new Scope());
    await settle(client);
    expect(warn.mock.calls.filter(([m]) => String(m).includes('disabled for 1 h'))).toHaveLength(1);
  });

  it('halves the cap after 413 and logs 400', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = make(
      { debug: true },
      {},
      { kind: 'drop', reason: 'too_large' },
      { kind: 'drop', reason: 'invalid' },
    );
    client.captureMessage('x'.repeat(3000), new Scope());
    await settle(client);
    expect(client.maxEnvelopeBytes).toBeLessThan(2000);
    client.captureMessage('y', new Scope());
    await settle(client);
    expect(warn).toHaveBeenCalledWith('[beacon] envelope dropped (invalid)');
  });

  it('counts queue evictions and in-flight overflow', async () => {
    const queue = makeMemoryQueue({ maxEnvelopes: 1, maxBytes: 1e6, ttlMs: 1e9 }, clock);
    const { client, transport } = make(
      { queue },
      {},
      { kind: 'retry', afterMs: 1000, reason: 'ratelimit' },
    );
    client.captureMessage('a', new Scope());
    await settle(client);
    client.captureMessage('b', new Scope());
    await settle(client);
    expect(await queue.size()).toBe(1);
    const slow = make({ queue: false }, { inFlightCap: 1 });
    slow.transport.send = vi.fn(
      () =>
        new Promise<TransportResult>((resolve) => setTimeout(() => resolve({ kind: 'ok' }), 100)),
    );
    slow.client.captureMessage('one', new Scope());
    slow.client.captureMessage('two', new Scope());
    await vi.advanceTimersByTimeAsync(200);
    await settle(slow.client);
    expect(slow.transport.send).toHaveBeenCalledTimes(1);
    expect(transport.requests).toHaveLength(1);
  });

  it('keeps queued envelopes while in-flight slots are full', async () => {
    const queue = makeMemoryQueue(undefined, clock);
    await queue.push({
      id: 'q1',
      createdAt: now,
      category: 'error',
      eventId: 'q1',
      header: {},
      items: [{ type: 'event', payload: '{}' }],
    });
    const { client, transport } = make({ queue }, { inFlightCap: 0 });
    await client.drainQueue(false);
    expect(transport.requests).toHaveLength(0);
    expect(await queue.size()).toBe(1);
  });
});

describe('Client reports, flush and close', () => {
  it('sends client reports at most once per 60 s, deferring while blocked or throttled', async () => {
    const { client, transport } = make(
      { sampleRate: 0 },
      { throttle: { perMinute: 100, burst: 1, refillPerSecond: 0 } },
    );
    client.captureMessage('a', new Scope());
    await settle(client);
    now += 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    await settle(client);
    expect(reports(transport)).toHaveLength(1);
    client.captureMessage('b', new Scope());
    await settle(client);
    now += 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    await settle(client);
    expect(reports(transport)).toHaveLength(1);
    await client.sendClientReport(true);
    expect(reports(transport)).toHaveLength(2);
    await client.sendClientReport(false);
    expect(reports(transport)).toHaveLength(2);
  });

  it('defers the client report while backed off and never queues it', async () => {
    const queue = makeMemoryQueue(undefined, clock);
    const { client, transport } = make(
      { sampleRate: 0, queue },
      {},
      { kind: 'retry', afterMs: 120_000, reason: 'ratelimit' },
    );
    client.captureMessage('a', new Scope());
    await settle(client);
    await client.sendClientReport(true);
    expect(await queue.size()).toBe(0);
    client.captureMessage('b', new Scope());
    await client.sendClientReport(false);
    await client.sendClientReport(false);
    expect(transport.requests).toHaveLength(1);
    now += 120_001;
    await vi.advanceTimersByTimeAsync(120_001);
    await settle(client);
    expect(reports(transport)).toHaveLength(2);
  });

  it('reschedules a timed report that fires while backed off', async () => {
    const { client, transport } = make(
      { queue: false },
      {},
      { kind: 'retry', afterMs: 300_000, reason: 'ratelimit' },
    );
    client.captureMessage('a', new Scope());
    await settle(client);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reports(transport)).toHaveLength(0);
    now += 300_001;
    await vi.advanceTimersByTimeAsync(300_000);
    await settle(client);
    expect(reports(transport)).toHaveLength(1);
  });

  it('does not count discards when client reports are off', async () => {
    const { client, transport } = make({ sampleRate: 0, sendClientReports: false });
    client.captureMessage('a', new Scope());
    await client.close(100);
    expect(transport.requests).toHaveLength(0);
  });

  it('close stops capture, sends the pending report and tears integrations down', async () => {
    const teardown = vi.fn();
    const { client, transport } = make(
      { sampleRate: 0 },
      { defaultIntegrations: [{ name: 'T', teardown }] },
    );
    client.captureMessage('a', new Scope());
    expect(await client.close(1000)).toBe(true);
    expect(teardown).toHaveBeenCalled();
    expect(reports(transport)).toHaveLength(1);
    expect(client.isActive()).toBe(false);
    expect(await client.close()).toBe(true);
    client.captureMessage('b', new Scope());
    await client.flush();
    expect(transport.requests).toHaveLength(1);
  });

  it('flush resolves false on timeout and with unload sends via the queue', async () => {
    const { client, transport } = make();
    transport.send = vi.fn(() => new Promise<TransportResult>(() => {}));
    client.captureMessage('a', new Scope());
    const flushed = client.flush(50);
    await vi.advanceTimersByTimeAsync(60);
    expect(await flushed).toBe(false);
    const queue = makeMemoryQueue(undefined, clock);
    const unload = make({ queue });
    await queue.push({
      id: 'q',
      createdAt: now,
      category: 'error',
      eventId: 'q',
      header: { event_id: 'q' },
      items: [{ type: 'event', payload: '{}' }],
    });
    expect(await unload.client.flush(1000, true)).toBe(true);
    expect(unload.transport.requests[0]!.unload).toBe(true);
    const disabled = new Client({ dsn: 'bad' }, platform());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await disabled.flush(10)).toBe(true);
    await disabled.drainQueue(false);
    await disabled.sendClientReport(true);
    expect(await disabled.close(10)).toBe(true);
  });

  it('records breadcrumbs through beforeBreadcrumb and the limit', () => {
    const scope = new Scope();
    const { client } = make({
      maxBreadcrumbs: 2,
      beforeBreadcrumb: (crumb) => (crumb.message === 'no' ? null : crumb),
    });
    client.addBreadcrumb({ message: 'no' }, scope);
    client.addBreadcrumb({ message: 'a' }, scope);
    client.addBreadcrumb({ message: 'b' }, scope);
    client.addBreadcrumb({ message: 'c', timestamp: 5 }, scope);
    expect(scope.breadcrumbs).toEqual([
      { timestamp: now / 1000, message: 'b' },
      { timestamp: 5, message: 'c' },
    ]);
    make({ maxBreadcrumbs: 0 }).client.addBreadcrumb({ message: 'x' }, scope);
    make({ maxBreadcrumbs: 500 }).client.addBreadcrumb({ message: 'x' }, scope);
    make({ enabled: false }).client.addBreadcrumb({ message: 'y' }, scope);
    expect(scope.breadcrumbs.map((b) => b.message)).toEqual(['b', 'c', 'x']);
    expect(make().client.maxBreadcrumbs).toBe(50);
  });

  it('reports outcomes', async () => {
    const outcomes: unknown[] = [];
    const { client } = make(
      { onOutcome: (o) => outcomes.push(o) },
      {},
      { kind: 'ok' },
      { kind: 'retry', afterMs: 0, reason: 'unavailable', status: 503 },
      { kind: 'drop', reason: 'client', status: 404 },
    );
    const id = client.captureMessage('a', new Scope());
    await settle(client);
    now += 400_000;
    client.captureMessage('b', new Scope());
    await settle(client);
    now += 400_000;
    client.captureMessage('c', new Scope());
    await settle(client);
    expect(outcomes).toEqual([
      { type: 'captured', eventId: id },
      { type: 'error', status: 503 },
      { type: 'dropped', reason: 'network_error' },
      { type: 'error', status: 404 },
    ]);
  });

  it('never sends credentials in the URL', async () => {
    const { client, transport } = make({ dsn: SERVER_DSN, authProvider: beaconServerAuth() });
    client.captureMessage('x', new Scope());
    await settle(client);
    expect(transport.requests[0]!.url).not.toMatch(
      /beacon_key|beacon_secret|sentry_key|bk_|secret/,
    );
    expect(transport.requests[0]!.headers).toEqual({
      'X-Beacon-Auth': 'Beacon beacon_key=test-public, beacon_secret=test-secret-not-real',
    });
    expect(transport.requests[0]!.body).not.toContain('test-secret-not-real');
  });
});
