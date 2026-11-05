import { describe, expect, it } from 'vitest';
import { EXTRA_LIMITS, normalize } from '../src/normalize.js';

const limits = { depth: 2, maxKeys: 2, maxArray: 2, maxString: 5 };

describe('normalize', () => {
  it('handles primitives', () => {
    expect(normalize('abcdefgh', limits)).toBe('abcd…');
    expect(normalize(1, limits)).toBe(1);
    expect(normalize(Number.NaN, limits)).toBe('NaN');
    expect(normalize(true, limits)).toBe(true);
    expect(normalize(10n, limits)).toBe('10n');
    expect(normalize(Symbol('s'), limits)).toBe('Symbol(s)');
    expect(normalize(function named() {}, limits)).toBe('[Function: named]');
    expect(normalize(() => {}, { ...limits, maxString: 100 })).toMatch(/^\[Function: /);
    expect(normalize(undefined, limits)).toBeUndefined();
    expect(normalize(null, limits)).toBeNull();
  });

  it('handles anonymous functions', () => {
    const fn = (() => () => {})();
    Object.defineProperty(fn, 'name', { value: '' });
    expect(normalize(fn, EXTRA_LIMITS)).toBe('[Function: anonymous]');
  });

  it('handles dates', () => {
    expect(normalize(new Date(0), EXTRA_LIMITS)).toBe('1970-01-01T00:00:00.000Z');
    expect(normalize(new Date(Number.NaN), EXTRA_LIMITS)).toBe('Invalid Date');
  });

  it('limits depth, keys and arrays', () => {
    expect(normalize({ a: { b: { c: 1 } }, d: [1, [2]] }, limits)).toEqual({
      a: { b: '[Object]' },
      d: [1, '[Array]'],
    });
    expect(normalize({ a: 1, b: undefined, c: 2, d: 3 }, limits)).toEqual({ a: 1, c: 2 });
    expect(normalize([1, 2, 3], limits)).toEqual([1, 2]);
    expect(normalize([undefined], limits)).toEqual([null]);
  });

  it('marks cycles but not repeated siblings', () => {
    const a: Record<string, unknown> = { x: 1 };
    a['self'] = a;
    const shared = { y: 1 };
    expect(normalize(a, EXTRA_LIMITS)).toEqual({ x: 1, self: '[Circular]' });
    expect(normalize({ p: shared, q: shared }, EXTRA_LIMITS)).toEqual({ p: { y: 1 }, q: { y: 1 } });
  });

  it('serialises errors and well-formed keys', () => {
    const error = Object.assign(new Error('boom'), { code: 7 });
    expect(normalize(error, EXTRA_LIMITS)).toMatchObject({
      name: 'Error',
      message: 'boom',
      code: 7,
    });
    expect(normalize({ 'k\uD800': 1 }, EXTRA_LIMITS)).toEqual({ 'k�': 1 });
  });
});
