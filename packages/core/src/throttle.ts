export interface ThrottleOptions {
  /** Requests per rolling minute. */
  perMinute: number;
  /** Token bucket size. */
  burst: number;
  /** Tokens refilled per second. */
  refillPerSecond: number;
}

/** Client-side self-throttle (contract §4.6): a rolling-minute window plus a token bucket. */
export class Throttle {
  private readonly sent: number[] = [];
  private tokens: number;
  private refilledAt: number;

  constructor(
    private readonly options: ThrottleOptions,
    private readonly now: () => number,
  ) {
    this.tokens = options.burst;
    this.refilledAt = now();
  }

  /** Takes one request slot, or returns false when the request must not be sent. */
  take(): boolean {
    const now = this.now();
    while (this.sent.length && this.sent[0]! <= now - 60_000) this.sent.shift();
    this.tokens = Math.min(
      this.options.burst,
      this.tokens + ((now - this.refilledAt) / 1000) * this.options.refillPerSecond,
    );
    this.refilledAt = now;
    if (this.sent.length >= this.options.perMinute || this.tokens < 1) return false;
    this.tokens -= 1;
    this.sent.push(now);
    return true;
  }
}

/** Clamps user throttle options to the platform defaults when they may only be lowered (browser). */
export function resolveThrottle(
  defaults: ThrottleOptions,
  user: Partial<ThrottleOptions> | undefined,
  lowerOnly: boolean,
): ThrottleOptions {
  const pick = (key: keyof ThrottleOptions): number => {
    const value = user?.[key];
    if (value === undefined || !(value >= 0)) return defaults[key];
    return lowerOnly ? Math.min(value, defaults[key]) : value;
  };
  return {
    perMinute: pick('perMinute'),
    burst: pick('burst'),
    refillPerSecond: pick('refillPerSecond'),
  };
}
