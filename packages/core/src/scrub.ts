import type { BeaconEvent, Breadcrumb } from './types.js';
import { isPlainObject } from './utils.js';

export type Scrubber = (event: BeaconEvent) => BeaconEvent;

export const FILTERED = '[Filtered]';

/** Header names redacted everywhere (Beacon's `EventPayloadScrubber` list plus the CSRF headers). */
export const SENSITIVE_HEADERS: readonly string[] = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-beacon-auth',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
];

export const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|api[-_]?key|auth|credential|session|cookie|csrf|xsrf|private[-_]?key|card|cvv|iban|ssn/i;
const SENSITIVE_QUERY = /^(?:code|state|access_token|id_token|refresh_token|sig|signature)$/i;

const CREDENTIAL_PATTERNS: ReadonlyArray<[RegExp, (match: string) => string]> = [
  [/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, () => FILTERED],
  [/\bBearer\s+[\w.~+/-]+=*/gi, () => `Bearer ${FILTERED}`],
  [/\bbk_\w+/g, () => FILTERED],
  // 32+ character hex or base64url runs that mix letters and digits (secrets, keys, signatures).
  [
    /[A-Za-z0-9_-]{32,}/g,
    (match) => (/\d/.test(match) && /[A-Za-z]/.test(match) ? FILTERED : match),
  ],
];

/** Masks values that look like credentials (JWTs, bearer tokens, `bk_` keys, long secrets). */
export function maskCredentials(text: string): string {
  let out = text;
  for (const [pattern, replace] of CREDENTIAL_PATTERNS) out = out.replace(pattern, replace);
  return out;
}

function isSensitiveQueryName(name: string): boolean {
  return SENSITIVE_KEY.test(name) || SENSITIVE_QUERY.test(name);
}

/** Replaces sensitive query values with `[Filtered]` and drops the fragment. */
export function scrubUrl(url: string): string {
  const withoutHash = url.split('#')[0]!;
  const q = withoutHash.indexOf('?');
  if (q === -1) return withoutHash;
  const query = withoutHash
    .slice(q + 1)
    .split('&')
    .map((pair) => {
      const name = pair.split('=')[0]!;
      let decoded = name;
      try {
        decoded = decodeURIComponent(name);
      } catch {
        // keep the raw name
      }
      return isSensitiveQueryName(decoded) ? `${name}=${FILTERED}` : pair;
    })
    .join('&');
  return `${withoutHash.slice(0, q + 1)}${query}`;
}

/** Redacts sensitive keys (deep). Returns new objects; never mutates the input. */
export function scrubObject(value: unknown, depth = 10): unknown {
  if (depth <= 0) return value;
  if (Array.isArray(value)) return value.map((item) => scrubObject(item, depth - 1));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? FILTERED : scrubObject(item, depth - 1);
  }
  return out;
}

export function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    out[name] = SENSITIVE_HEADERS.includes(lower) || SENSITIVE_KEY.test(lower) ? FILTERED : value;
  }
  return out;
}

const URL_KEYS = ['url', 'from', 'to'];

function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const out: Breadcrumb = { ...crumb };
  if (out.message !== undefined) out.message = maskCredentials(out.message);
  if (out.data) {
    const data = scrubObject(out.data) as Record<string, unknown>;
    for (const [key, item] of Object.entries(data)) {
      if (typeof item !== 'string') continue;
      data[key] = URL_KEYS.includes(key) ? scrubUrl(item) : maskCredentials(item);
    }
    out.data = data;
  }
  return out;
}

/**
 * The default scrubber (contract §5): `request`, `extra`, `contexts`, `tags`, breadcrumb `data`, URLs, messages and
 * exception values.
 */
export const defaultScrubber: Scrubber = (event) => {
  const out: BeaconEvent = { ...event };
  if (out.message !== undefined) out.message = maskCredentials(out.message);
  if (out.exception) {
    out.exception = {
      values: out.exception.values.map((value) => ({
        ...value,
        value: maskCredentials(value.value),
      })),
    };
  }
  if (out.request) {
    const request = { ...out.request };
    if (request.url !== undefined) request.url = scrubUrl(request.url);
    if (request.query_string !== undefined)
      request.query_string = scrubUrl(`?${request.query_string}`).slice(1);
    if (request.headers) request.headers = scrubHeaders(request.headers);
    if (request.cookies !== undefined) request.cookies = FILTERED;
    if (request.data !== undefined) request.data = scrubObject(request.data);
    out.request = request;
  }
  if (out.extra) out.extra = scrubObject(out.extra) as Record<string, unknown>;
  if (out.contexts) out.contexts = scrubObject(out.contexts) as BeaconEvent['contexts'] & object;
  if (out.tags) out.tags = scrubObject(out.tags) as Record<string, string>;
  if (out.breadcrumbs) out.breadcrumbs = { values: out.breadcrumbs.values.map(scrubBreadcrumb) };
  return out;
};
