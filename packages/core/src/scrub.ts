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

function luhn(text: string): boolean {
  let sum = 0;
  const digits = text.replace(/\D/g, '');
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

const CREDENTIAL_PATTERNS: ReadonlyArray<[RegExp, (match: string) => string]> = [
  [/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, () => FILTERED],
  [/\bBearer\s+[\w.~+/-]+=*/gi, () => `Bearer ${FILTERED}`],
  [/\bbk_\w+/g, () => FILTERED],
  // Prefixed keys and tokens (`sk_live_…`, `pk_test_…`, `ghp_…`), whatever surrounds them.
  [/\b(?:sk|pk|rk|ghp|gho|xox[abpr])[-_]\w{8,}/g, () => FILTERED],
  // Card-number-like runs: 13 to 19 digits (optionally grouped with spaces or dashes) that pass the Luhn check, so
  // that timestamps and ids stay readable.
  [/\b\d(?:[ -]?\d){12,18}\b/g, (match) => (luhn(match) ? FILTERED : match)],
  // 32+ character hex or base64url runs that mix letters and digits (secrets, keys, signatures).
  [
    /[A-Za-z0-9_-]{32,}/g,
    (match) => (/\d/.test(match) && /[A-Za-z]/.test(match) ? FILTERED : match),
  ],
];

/** Masks values that look like credentials: JWTs, bearer tokens, `bk_`/`sk_`-like keys, long secrets, card numbers. */
export function maskCredentials(text: string): string {
  let out = text;
  for (const [pattern, replace] of CREDENTIAL_PATTERNS) out = out.replace(pattern, replace);
  return out;
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function isSensitiveQueryName(name: string): boolean {
  return SENSITIVE_KEY.test(name) || SENSITIVE_QUERY.test(name);
}

/**
 * Removes `user:pass@`, replaces query values with `[Filtered]` when the name is sensitive or the value looks like
 * a credential, and drops the fragment.
 */
export function scrubUrl(url: string): string {
  const withoutHash = String(url)
    .split('#')[0]!
    .replace(/^\s+/, '')
    // userinfo after `scheme://` or a protocol-relative `//` (FVD-I3)
    .replace(/^((?:[a-z][a-z0-9+.-]*:)?\/\/)[^/?#]*@/i, '$1');
  const q = withoutHash.indexOf('?');
  if (q === -1) return withoutHash;
  const query = withoutHash
    .slice(q + 1)
    .split('&')
    .map((pair) => {
      const [name, ...rest] = pair.split('=');
      const value = decode(rest.join('='));
      const sensitive = isSensitiveQueryName(decode(name!)) || maskCredentials(value) !== value;
      return sensitive ? `${name}=${FILTERED}` : pair;
    })
    .join('&');
  return `${withoutHash.slice(0, q + 1)}${query}`;
}

/** Latin look-alikes of the scrubber's key letters (Cyrillic and Greek), after NFKC. */
const CONFUSABLES: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  ѕ: 's',
  і: 'i',
  ј: 'j',
  к: 'k',
  т: 't',
  н: 'h',
  в: 'b',
  м: 'm',
  ԁ: 'd',
  ԛ: 'q',
  ԝ: 'w',
  ɑ: 'a',
  ο: 'o',
  α: 'a',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ρ: 'p',
  τ: 't',
};

/** A key as the sensitive-key regex should see it: NFKC, with Cyrillic/Greek look-alikes folded to Latin. */
export function keyForMatch(key: string): string {
  return key
    .normalize('NFKC')
    .replace(/[\u0080-\uffff]/g, (char) => CONFUSABLES[char.toLowerCase()] ?? char);
}

/** True for a sensitive key, also when it is written with look-alike letters (`pаssword` with a Cyrillic а). */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || SENSITIVE_KEY.test(keyForMatch(key));
}

/** A Luhn-valid 13–19 digit integer: a card number sent as a JSON number (FVD-I1). */
export function isCardNumber(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    /^\d{13,19}$/.test(String(value)) &&
    luhn(String(value))
  );
}

/** Redacts sensitive keys and card numbers (deep). Returns new objects; never mutates the input. */
export function scrubObject(value: unknown, depth = 10): unknown {
  if (isCardNumber(value)) return FILTERED;
  if (depth <= 0) return value;
  if (Array.isArray(value)) return value.map((item) => scrubObject(item, depth - 1));
  if (!isPlainObject(value)) return value;
  // Own properties only (never an assignment through a computed key), and never keys that would reach a prototype.
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '__proto__' && key !== 'constructor' && key !== 'prototype')
      .map(([key, item]) => [key, isSensitiveKey(key) ? FILTERED : scrubObject(item, depth - 1)]),
  );
}

export function scrubHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    out[name] = SENSITIVE_HEADERS.includes(lower) || isSensitiveKey(lower) ? FILTERED : value;
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
