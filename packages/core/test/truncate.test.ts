import { describe, expect, it } from 'vitest';
import { serializeLine } from '../src/envelope.js';
import type { BeaconEvent } from '../src/types.js';
import { applyCaps, fitEvent } from '../src/truncate.js';
import { byteLength } from '../src/utils.js';

const frames = (n: number, extra: Record<string, unknown> = {}) =>
  Array.from({ length: n }, (_, i) => ({
    filename: `/f${i}.js`,
    function: `fn${i}`,
    lineno: i,
    ...extra,
  }));

describe('applyCaps', () => {
  it('caps every field', () => {
    const event: BeaconEvent = {
      message: 'm'.repeat(20000),
      exception: {
        values: [
          { type: 'E', value: 'v'.repeat(9000), stacktrace: { frames: frames(70) } },
          { type: 'F', value: 'x' },
        ],
      },
      breadcrumbs: {
        values: Array.from({ length: 120 }, (_, i) => ({
          message: `c${i}`,
          data: { s: 's'.repeat(3000) },
        })).concat([{ message: 'last' } as never]),
      },
      extra: { deep: { a: { b: { c: { d: { e: { f: 1 } } } } } } },
      contexts: { c: { long: 'x'.repeat(3000) } },
      tags: Object.fromEntries(
        Array.from({ length: 60 }, (_, i) => [`${i}${'k'.repeat(40)}`, 'v'.repeat(300)]),
      ),
    };
    applyCaps(event, 500);
    expect(event.message).toHaveLength(16384);
    expect(event.exception!.values[0]!.value).toHaveLength(8192);
    expect(event.exception!.values[0]!.stacktrace!.frames).toHaveLength(64);
    expect(event.exception!.values[0]!.stacktrace!.frames_omitted).toEqual([32, 38]);
    expect(event.breadcrumbs!.values).toHaveLength(100);
    expect(event.breadcrumbs!.values[99]!.message).toBe('last');
    expect((event.breadcrumbs!.values[0]!.data!['s'] as string).length).toBe(2048);
    expect(JSON.stringify(event.extra)).toContain('[Object]');
    expect((event.contexts!['c']!['long'] as string).length).toBe(2048);
    expect(Object.keys(event.tags!)).toHaveLength(50);
    expect(Object.keys(event.tags!)[0]).toHaveLength(32);
    expect(Object.values(event.tags!)[0]).toHaveLength(200);
  });

  it('drops breadcrumbs when the limit is 0 and leaves small events alone', () => {
    const event: BeaconEvent = { breadcrumbs: { values: [{ message: 'a' }] } };
    expect(applyCaps(event, 0).breadcrumbs!.values).toEqual([]);
    expect(applyCaps({ exception: { values: [{ type: 'E', value: 'v' }] } }, 50)).toEqual({
      exception: { values: [{ type: 'E', value: 'v' }] },
    });
  });
});

describe('fitEvent', () => {
  it('returns small events unchanged', () => {
    const event = { message: 'x' };
    expect(fitEvent(event, 1000)).toEqual({ event, line: serializeLine(event) });
  });

  it('drops extra first', () => {
    const result = fitEvent({ message: 'x', extra: { big: 'y'.repeat(5000) } }, 1000)!;
    expect(result.event.extra).toEqual({ __truncated__: ['extra'] });
  });

  it('then the oldest breadcrumbs', () => {
    const crumbs = Array.from({ length: 50 }, (_, i) => ({ message: `${i}`.padEnd(100, '.') }));
    const result = fitEvent({ extra: { a: 1 }, breadcrumbs: { values: crumbs } }, 3000)!;
    const steps = result.event.extra!['__truncated__'] as string[];
    expect(steps[0]).toBe('extra');
    expect(steps[1]).toMatch(/^breadcrumbs:\d+$/);
    expect(result.event.breadcrumbs!.values.at(-1)!.message).toMatch(/^49/);
    expect(byteLength(result.line)).toBeLessThanOrEqual(3000);
  });

  it('then the source context, then middle frames', () => {
    const context = {
      pre_context: ['p'.repeat(200)],
      context_line: 'c'.repeat(200),
      post_context: ['q'.repeat(200)],
    };
    const event: BeaconEvent = {
      exception: {
        values: [
          { type: 'E', value: 'v', stacktrace: { frames: frames(10, context) } },
          { type: 'F', value: 'w' },
        ],
      },
      breadcrumbs: { values: [{ message: 'b' }] },
    };
    const contextOnly = fitEvent(structuredClone(event), 2000)!;
    expect(contextOnly.event.extra!['__truncated__']).toEqual(['breadcrumbs:1', 'source_context']);
    const result = fitEvent(structuredClone(event), 500)!;
    expect(result.event.extra!['__truncated__']).toEqual([
      'breadcrumbs:1',
      'source_context',
      expect.stringMatching(/^frames:\d+$/),
    ]);
    expect(byteLength(result.line)).toBeLessThanOrEqual(500);
  });

  it('gives up when the event cannot fit', () => {
    expect(fitEvent({ message: 'x'.repeat(1000) }, 100)).toBeUndefined();
    expect(
      fitEvent(
        {
          exception: {
            values: [{ type: 'E', value: 'v'.repeat(1000), stacktrace: { frames: frames(3) } }],
          },
        },
        100,
      ),
    ).toBeUndefined();
  });
});
