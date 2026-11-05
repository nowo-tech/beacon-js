import { describe, expect, it } from 'vitest';
import {
  byteLength,
  isErrorLike,
  isPlainObject,
  matchesAny,
  schedule,
  truncate,
  uuid4,
  wellFormed,
} from '../src/utils.js';

describe('utils', () => {
  it('makes 32-hex v4 ids', () => {
    const id = uuid4();
    expect(id).toMatch(/^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/);
    expect(uuid4()).not.toBe(id);
  });

  it('measures UTF-8 bytes', () => {
    expect(byteLength('a')).toBe(1);
    expect(byteLength('ñ')).toBe(2);
    expect(byteLength('😀')).toBe(4);
  });

  it('replaces lone surrogates only', () => {
    expect(wellFormed('plain')).toBe('plain');
    expect(wellFormed('😀')).toBe('😀');
    expect(wellFormed('a\uD800b')).toBe('a�b');
    expect(wellFormed('a\uDC00b')).toBe('a�b');
    expect(wellFormed('\uD800')).toBe('�');
    expect(wellFormed('\uDC00\uDC00')).toBe('��');
  });

  it('truncates with an ellipsis', () => {
    expect(truncate('abc', 5)).toBe('abc');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abcdef', 0)).toBe('…');
  });

  it('detects plain objects and error-likes', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('x')).toBe(false);
    expect(isErrorLike(new TypeError('x'))).toBe(true);
    expect(isErrorLike({ name: 'E', message: 'm' })).toBe(true);
    expect(isErrorLike({ message: 'm' })).toBe(false);
    expect(isErrorLike(null)).toBe(false);
    expect(isErrorLike('x')).toBe(false);
  });

  it('matches strings and regexps', () => {
    expect(matchesAny('hello world', ['world'])).toBe(true);
    expect(matchesAny('hello', [/^h/])).toBe(true);
    expect(matchesAny('hello', ['x', /y/])).toBe(false);
  });

  it('schedules unref timers', async () => {
    await new Promise<void>((resolve) => schedule(resolve, 1));
  });
});
