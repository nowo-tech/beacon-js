import { vi } from 'vitest';
import { envelopeDsnAuth } from '../src/auth.js';
import type { PlatformConfig } from '../src/client.js';
import { normalizeUrlFilename } from '../src/stack.js';
import type { Transport, TransportRequest, TransportResult } from '../src/transport.js';

export const BROWSER_DSN =
  'https://bk_test_0000000000000000@beacon.test/00000000-0000-4000-8000-000000000001';
export const SERVER_DSN =
  'https://test-public:test-secret-not-real@beacon.test/00000000-0000-4000-8000-000000000001';

export interface RecordingTransport extends Transport {
  requests: TransportRequest[];
  results: TransportResult[];
}

/** A transport that records requests and answers from a queue of results (default ok). */
export function recordingTransport(...results: TransportResult[]): RecordingTransport {
  const requests: TransportRequest[] = [];
  return {
    requests,
    results,
    send: vi.fn((request: TransportRequest) => {
      requests.push(request);
      return Promise.resolve(results.shift() ?? { kind: 'ok' as const });
    }),
    flush: vi.fn(() => Promise.resolve(true)),
  };
}

export function platform(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  return {
    platform: 'javascript',
    sdkName: 'nowo.javascript.test',
    sdkVersion: '0.0.0-test',
    defaultIntegrations: [],
    defaultAuth: envelopeDsnAuth,
    makeTransport: () => recordingTransport(),
    validateDsn: () => undefined,
    onConfigError: 'warn',
    maxEnvelopeBytes: 200_000,
    lowerOnly: true,
    throttle: { perMinute: 1000, burst: 1000, refillPerSecond: 1000 },
    identicalWindowMs: 0,
    inFlightCap: 10,
    normalizeFilename: normalizeUrlFilename,
    ...overrides,
  };
}

/** Parses an envelope body into its lines (JSON). */
export function parseEnvelope(body: string): {
  header: Record<string, unknown>;
  items: Array<{ header: Record<string, unknown>; payload: Record<string, unknown> }>;
} {
  const lines = body.split('\n');
  const header = JSON.parse(lines[0]!) as Record<string, unknown>;
  const items = [];
  for (let i = 1; i < lines.length; i += 2) {
    items.push({
      header: JSON.parse(lines[i]!) as Record<string, unknown>,
      payload: JSON.parse(lines[i + 1]!) as Record<string, unknown>,
    });
  }
  return { header, items };
}

export function eventOf(request: TransportRequest): Record<string, any> {
  return parseEnvelope(request.body).items[0]!.payload;
}
