import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isInApp,
  isSdkFrame,
  limitFrames,
  normalizeUrlFilename,
  parseGeckoLine,
  parseStack,
  parseV8Line,
  toStacktrace,
  type RawFrame,
} from '../src/stack.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`fixtures/${name}.txt`, import.meta.url), 'utf8');
const options = { normalizeFilename: normalizeUrlFilename };

describe('V8 parser', () => {
  it('parses the fixture newest first', () => {
    expect(parseStack(fixture('v8'))).toEqual([
      {
        function: 'handleClick',
        abs_path: 'https://app.test/assets/index-3f9a1c2b.js?v=1',
        lineno: 10,
        colno: 15,
      },
      {
        function: 'loadData',
        abs_path: 'https://app.test/assets/index-3f9a1c2b.js',
        lineno: 20,
        colno: 3,
      },
      { function: 'new Widget', abs_path: 'https://app.test/src/widget.js', lineno: 5, colno: 9 },
      { function: 'Array.forEach', abs_path: '<anonymous>' },
      { function: 'eval', abs_path: 'https://app.test/vendor.js', lineno: 3, colno: 10 },
      { function: '?', abs_path: 'https://app.test/main.js', lineno: 1, colno: 1 },
      {
        function: 'Object.<anonymous>',
        abs_path: '/app/node_modules/lib/index.js',
        lineno: 2,
        colno: 3,
      },
      {
        function: 'Module._compile',
        abs_path: 'node:internal/modules/cjs/loader',
        lineno: 1554,
        colno: 14,
      },
      { function: '?', abs_path: 'chrome-extension://abc/content.js', lineno: 1, colno: 1 },
      { function: 'Promise.all', abs_path: 'index 0' },
      { function: '?', abs_path: 'native' },
    ]);
  });

  it('handles edge lines', () => {
    expect(parseV8Line('not a frame')).toBeUndefined();
    expect(parseV8Line('    at  (x.js:1:2)')).toEqual({
      function: '?',
      abs_path: 'x.js',
      lineno: 1,
      colno: 2,
    });
    expect(parseV8Line('    at fn (address at https://x.test/a.js:1:2)')).toMatchObject({
      abs_path: 'https://x.test/a.js',
    });
    expect(parseV8Line('    at eval (eval at <anonymous>)')).toEqual({
      function: 'eval',
      abs_path: 'eval at <anonymous>',
    });
    expect(parseV8Line('    at fn (x.js:7)')).toEqual({
      function: 'fn',
      abs_path: 'x.js',
      lineno: 7,
    });
  });
});

describe('SpiderMonkey and JSC parsers', () => {
  it('parses Firefox stacks', () => {
    expect(parseStack(fixture('spidermonkey'))).toEqual([
      {
        function: 'handleClick',
        abs_path: 'https://app.test/assets/index-3f9a1c2b.js',
        lineno: 10,
        colno: 15,
      },
      {
        function: 'loadData/<',
        abs_path: 'https://app.test/assets/index.js',
        lineno: 20,
        colno: 3,
      },
      { function: '?', abs_path: 'https://app.test/main.js', lineno: 1, colno: 1 },
      { function: 'evalFn', abs_path: 'https://app.test/vendor.js', lineno: 3 },
      { function: 'fnFn', abs_path: 'https://app.test/vendor.js', lineno: 7 },
      { function: 'moz', abs_path: 'moz-extension://abc/content.js', lineno: 1, colno: 1 },
    ]);
  });

  it('parses Safari stacks', () => {
    expect(parseStack(fixture('jsc'))).toEqual([
      {
        function: 'handleClick',
        abs_path: 'https://app.test/assets/index.js',
        lineno: 10,
        colno: 15,
      },
      { function: 'global code', abs_path: 'https://app.test/main.js', lineno: 1, colno: 1 },
      { function: 'forEach', abs_path: '[native code]' },
      { function: '?', abs_path: '[native code]' },
      { function: 'safari', abs_path: 'safari-web-extension://abc/c.js', lineno: 1, colno: 1 },
    ]);
    expect(parseGeckoLine('   ')).toBeUndefined();
  });
});

describe('frames', () => {
  it('builds oldest-first frames with in_app and normalised filenames', () => {
    const stacktrace = toStacktrace(parseStack(fixture('v8')), options)!;
    const frames = stacktrace.frames;
    expect(frames[frames.length - 1]).toEqual({
      filename: '/assets/index.js',
      abs_path: 'https://app.test/assets/index-3f9a1c2b.js?v=1',
      function: 'handleClick',
      in_app: true,
      lineno: 10,
      colno: 15,
    });
    expect(frames.map((frame) => frame.in_app)).toEqual([
      false,
      true,
      false,
      false,
      false,
      true,
      true,
      false,
      true,
      true,
      true,
    ]);
  });

  it('removes SDK frames from the top only', () => {
    const raw: RawFrame[] = [
      { function: '__beaconWrapped', abs_path: 'https://app.test/a.js' },
      { function: 'x', abs_path: 'https://cdn.test/sdk/beacon-browser/0.1.0/beacon.min.js' },
      { function: 'app', abs_path: 'https://app.test/a.js' },
      { function: 'y', abs_path: '/node_modules/@nowo-tech/beacon-core/dist/index.mjs' },
    ];
    const frames = toStacktrace(raw, options)!.frames;
    expect(frames.map((frame) => frame.function)).toEqual(['y', 'app']);
    expect(frames[0]!.in_app).toBe(false);
    expect(isSdkFrame({ function: 'f', abs_path: 'x.js' })).toBe(false);
    expect(toStacktrace([raw[0]!], options)).toBeUndefined();
  });

  it('honours inAppInclude and inAppExclude', () => {
    expect(
      isInApp('/app/node_modules/mine/x.js', { ...options, inAppInclude: ['node_modules/mine'] }),
    ).toBe(true);
    expect(isInApp('/app/src/gen/x.js', { ...options, inAppExclude: [/\/gen\//] })).toBe(false);
    expect(
      isInApp('/app/src/x.js', { ...options, inAppInclude: ['nope'], inAppExclude: ['nope'] }),
    ).toBe(true);
  });

  it('normalises URLs', () => {
    expect(normalizeUrlFilename('https://app.test/assets/index-3f9a1c2b.js?v=1#x')).toBe(
      '/assets/index.js',
    );
    expect(normalizeUrlFilename('https://app.test/assets/chunk.0123abcd.mjs')).toBe(
      '/assets/chunk.mjs',
    );
    expect(normalizeUrlFilename('/static/app.js')).toBe('/static/app.js');
    expect(normalizeUrlFilename('[native code]')).toBe('[native code]');
  });

  it('keeps the 32 oldest and 32 newest of long stacks', () => {
    const frames = Array.from({ length: 70 }, (_, i) => ({ function: `f${i}` }));
    const limited = limitFrames(frames);
    expect(limited.frames).toHaveLength(64);
    expect(limited.frames_omitted).toEqual([32, 38]);
    expect(limited.frames[31]!.function).toBe('f31');
    expect(limited.frames[32]!.function).toBe('f38');
    expect(limitFrames(frames.slice(0, 3)).frames_omitted).toBeUndefined();
  });
});
