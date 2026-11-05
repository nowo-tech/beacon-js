export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 5 * 60 * 1000;
export const DEFAULT_RETRY_AFTER_MS = 60 * 1000;
export const QUOTA_MIN_MS = 60 * 60 * 1000;
/** No server answer can block the transport for longer than this (contract §4.3, FV-L1). */
export const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

/** Parses `Retry-After` (integer seconds, or an HTTP-date). Returns milliseconds, or `undefined` when invalid. */
export function parseRetryAfter(
  header: string | null | undefined,
  nowMs: number,
): number | undefined {
  if (header == null) return undefined;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  if (!/[a-z]/i.test(value)) return undefined;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - nowMs);
}

/** Parses `X-Sentry-Rate-Limits` (`<seconds>:<categories>:<scope>, …`) and returns the longest wait in ms. */
export function parseSentryRateLimits(header: string | null | undefined): number | undefined {
  if (!header) return undefined;
  let longest: number | undefined;
  for (const limit of header.split(',')) {
    const seconds = Number(limit.trim().split(':')[0]);
    if (Number.isFinite(seconds) && seconds >= 0) longest = Math.max(longest ?? 0, seconds * 1000);
  }
  return longest;
}

/** Exponential backoff with full jitter: base 1 s, factor 2, max 5 min. `attempt` starts at 1. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempt - 1, 20));
  return Math.floor(random() * cap);
}
