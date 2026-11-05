import { describe, expect, it } from 'vitest';
import { resolveThrottle, Throttle } from '../src/throttle.js';

describe('Throttle', () => {
  it('enforces the burst and refill', () => {
    let now = 0;
    const throttle = new Throttle({ perMinute: 100, burst: 2, refillPerSecond: 1 }, () => now);
    expect(throttle.take()).toBe(true);
    expect(throttle.take()).toBe(true);
    expect(throttle.take()).toBe(false);
    now = 1000;
    expect(throttle.take()).toBe(true);
    expect(throttle.take()).toBe(false);
  });

  it('enforces the rolling minute', () => {
    let now = 0;
    const throttle = new Throttle({ perMinute: 3, burst: 100, refillPerSecond: 100 }, () => now);
    for (let i = 0; i < 3; i++) expect(throttle.take()).toBe(true);
    expect(throttle.take()).toBe(false);
    now = 60_001;
    expect(throttle.take()).toBe(true);
  });

  it('lets 1000 errors per second through at most 30 per minute with the browser defaults', () => {
    let now = 0;
    const throttle = new Throttle({ perMinute: 30, burst: 5, refillPerSecond: 0.5 }, () => now);
    let sent = 0;
    for (let i = 0; i < 60_000; i++) {
      now = i;
      if (throttle.take()) sent++;
    }
    expect(sent).toBeLessThanOrEqual(30);
  });

  it('resolves options, lowering only on the browser', () => {
    const defaults = { perMinute: 30, burst: 5, refillPerSecond: 0.5 };
    expect(resolveThrottle(defaults, undefined, true)).toEqual(defaults);
    expect(
      resolveThrottle(defaults, { perMinute: 100, burst: 2, refillPerSecond: -1 }, true),
    ).toEqual({ perMinute: 30, burst: 2, refillPerSecond: 0.5 });
    expect(resolveThrottle(defaults, { perMinute: 100 }, false)).toEqual({
      ...defaults,
      perMinute: 100,
    });
  });
});
