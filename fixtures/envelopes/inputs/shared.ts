// Fixed, fake placeholders shared with Beacon's test fixtures (contract §11.5). Nothing here is a real credential.
export const PROJECT = '00000000-0000-4000-8000-000000000001';
export const HOST = 'beacon.test';
export const BROWSER_KEY = 'bk_golden_0000000000000000';
export const SERVER_KEY = 'golden-public';
export const SERVER_SECRET = 'golden-secret-not-real';
export const ORIGIN = 'https://app.test';
export const BROWSER_DSN = `https://${BROWSER_KEY}@${HOST}/${PROJECT}`;
export const SERVER_DSN = `https://${SERVER_KEY}:${SERVER_SECRET}@${HOST}/${PROJECT}`;
export const CLOCK_MS = 1730800000123;

export interface Expected {
  status: number;
  /** Items Beacon accepts (events), counts (client_report) or drops. */
  items?: { accepted: number; counted: number; dropped: number };
  event?: {
    platform: string;
    level: string;
    grouping: { type: string; value_normalised: string; filename: string; function: string };
  };
}

/** One golden case: what the SDK does (through the real client and encoder) and what Beacon must answer. */
export interface GoldenCase {
  name: string;
  since: string;
  /** Beacon features the case needs (spec 172 blocks), so that Beacon can skip cases ahead of its own release. */
  requires: string[];
  kind: 'browser' | 'server';
  /** Envelope-header `dsn` (default), or `X-Beacon-Auth`. */
  auth: 'envelope-dsn' | 'header' | 'server-header' | 'server-envelope-dsn';
  origin?: string | null;
  query?: string;
  gzip?: boolean;
  /** Runs the capture through the SDK. */
  capture?: (sdk: Sdk) => void;
  /** Builds the body directly (negative cases the SDK would never send). */
  rawBody?: () => string;
  options?: Record<string, unknown>;
  expected: Expected;
}

/** The subset of the SDK the inputs use. */
export interface Sdk {
  captureException(
    error: unknown,
    context?: Record<string, unknown>,
    hint?: Record<string, unknown>,
  ): string;
  captureMessage(message: string, level?: string): string;
  addBreadcrumb(crumb: Record<string, unknown>): void;
  setTag(key: string, value: string): void;
  setUser(user: Record<string, unknown>): void;
  setRequest(request: Record<string, unknown>): void;
  discard(reason: string, quantity: number): void;
}

/** An Error with a fixed `stack`, so that the golden output does not depend on the machine. */
export function fixedError(name: string, message: string, stack: string[], cause?: Error): Error {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = name;
  error.stack = [`${name}: ${message}`, ...stack].join('\n');
  return error;
}
