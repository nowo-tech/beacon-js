import { describe, expect, it } from 'vitest';
import { dedupeIntegration, dedupeKey } from '../src/dedupe.js';

const exception = (value: string) => ({
  exception: {
    values: [
      {
        type: 'E',
        value,
        stacktrace: { frames: [{ filename: 'a.js', lineno: 1, colno: 2, function: 'f' }, {}] },
      },
    ],
  },
});

describe('dedupe', () => {
  it('builds keys from type, value and top frames, or the message', () => {
    expect(dedupeKey(exception('v'))).toBe('E|v|a.js:1:2:f|:::');
    expect(dedupeKey({ message: 'm' })).toBe('message|m');
    expect(dedupeKey({})).toBe('message|');
    expect(dedupeKey({ exception: { values: [{ type: 'E', value: 'v' }] } })).toBe('E|v|');
  });

  it('drops an identical event within the window', () => {
    let now = 0;
    const integration = dedupeIntegration(5000, () => now);
    const hint = {};
    expect(integration.processEvent!(exception('v'), hint, undefined as never)).not.toBeNull();
    expect(integration.processEvent!(exception('v'), hint, undefined as never)).toBeNull();
    expect(integration.processEvent!(exception('w'), hint, undefined as never)).not.toBeNull();
    now = 6000;
    expect(integration.processEvent!(exception('w'), hint, undefined as never)).not.toBeNull();
    expect(dedupeIntegration().name).toBe('Dedupe');
    expect(dedupeIntegration().processEvent!({}, hint, undefined as never)).toEqual({});
  });
});
