import { describe, expect, it } from 'vitest';
import { backoffDelay, parseRetryAfter, parseSentryRateLimits } from '../src/ratelimit.js';

describe('Retry-After', () => {
  const now = Date.parse('2026-11-05T10:00:00Z');
  it.each([
    ['17', 17000],
    [' 0 ', 0],
    ['Thu, 05 Nov 2026 10:00:30 GMT', 30000],
    ['Thu, 05 Nov 2026 09:00:00 GMT', 0],
    ['garbage', undefined],
    ['-5', undefined],
    ['1.5', undefined],
    ['', undefined],
  ])('parses %j', (header, expected) => {
    expect(parseRetryAfter(header, now)).toBe(expected);
  });

  it('handles a missing header', () => {
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
  });

  it('parses X-Sentry-Rate-Limits and keeps the longest', () => {
    expect(parseSentryRateLimits('60:error:key, 120:transaction:organization, x:y')).toBe(120000);
    expect(parseSentryRateLimits('')).toBeUndefined();
    expect(parseSentryRateLimits(null)).toBeUndefined();
    expect(parseSentryRateLimits('bad')).toBeUndefined();
  });

  it('backs off exponentially with full jitter and a 5 min cap', () => {
    expect(backoffDelay(1, () => 0.999)).toBe(999);
    expect(backoffDelay(3, () => 0.5)).toBe(2000);
    expect(backoffDelay(40, () => 0.999)).toBe(299700);
    expect(backoffDelay(1, () => 0)).toBe(0);
    expect(backoffDelay(2)).toBeLessThan(2000);
  });
});
