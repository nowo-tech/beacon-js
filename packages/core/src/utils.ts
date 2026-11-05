/** Hex event id (32 lowercase hex characters, UUID v4 without dashes). */
export function uuid4(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  let hex = '';
  for (const byte of bytes) hex += (byte + 0x100).toString(16).slice(1);
  return hex;
}

const encoder = /* @__PURE__ */ new TextEncoder();

/** UTF-8 byte length of a string. */
export function byteLength(value: string): number {
  return encoder.encode(value).length;
}

/** Replaces lone UTF-16 surrogates with U+FFFD, so that every JSON parser accepts the text. */
export function wellFormed(value: string): string {
  if (!/[\uD800-\uDFFF]/.test(value)) return value;
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i]! + value[i + 1]!;
        i++;
        continue;
      }
      out += '�';
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += '�';
    } else {
      out += value[i]!;
    }
  }
  return out;
}

/** Cuts a string to `max` characters, ending with `…` when it was cut. */
export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, Math.max(0, max - 1)) + '…' : value;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

export function isErrorLike(value: unknown): value is Error {
  return (
    value instanceof Error ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as { message?: unknown }).message === 'string' &&
      typeof (value as { name?: unknown }).name === 'string')
  );
}

/** Matches a string against a list of plain substrings or regular expressions. */
export function matchesAny(value: string, patterns: ReadonlyArray<string | RegExp>): boolean {
  return patterns.some((pattern) =>
    typeof pattern === 'string' ? value.includes(pattern) : pattern.test(value),
  );
}

/** The largest delay `setTimeout` accepts (about 24.8 days). */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** Beacon's event id format: 32 lowercase hex characters. */
export const EVENT_ID = /^[0-9a-f]{32}$/;

/** setTimeout that never keeps a Node process alive, with the delay clamped to what timers accept. */
export function schedule(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  // Timers overflow above 2^31 - 1 ms and would fire at once, in a loop.
  const timer = setTimeout(fn, Math.min(Math.max(0, ms), MAX_TIMEOUT_MS));
  (timer as { unref?: () => void }).unref?.();
  return timer;
}
