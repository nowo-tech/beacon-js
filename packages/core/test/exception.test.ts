import { describe, expect, it } from 'vitest';
import { exceptionsFromError } from '../src/exception.js';
import { normalizeUrlFilename } from '../src/stack.js';

const options = { normalizeFilename: normalizeUrlFilename };
const mechanism = { type: 'generic', handled: true };

function err(name: string, message: string, extra: Record<string, unknown> = {}): Error {
  const error = Object.assign(
    new Error(message, extra['cause'] ? { cause: extra['cause'] } : undefined),
    extra,
  );
  error.name = name;
  error.stack = `${name}: ${message}\n    at fn (https://app.test/${name}.js:1:1)`;
  return error;
}

describe('exceptionsFromError', () => {
  it('builds one value with a stack', () => {
    const { values, serialized } = exceptionsFromError(err('TypeError', 'x'), mechanism, options);
    expect(serialized).toBeUndefined();
    expect(values).toEqual([
      {
        type: 'TypeError',
        value: 'x',
        mechanism,
        stacktrace: {
          frames: [
            {
              filename: '/TypeError.js',
              abs_path: 'https://app.test/TypeError.js',
              function: 'fn',
              in_app: true,
              lineno: 1,
              colno: 1,
            },
          ],
        },
      },
    ]);
  });

  it('handles missing names and stacks', () => {
    const error = new Error('m');
    error.name = '';
    delete (error as { stack?: string }).stack;
    expect(exceptionsFromError(error, mechanism, options).values[0]).toEqual({
      type: 'Error',
      value: 'm',
      mechanism,
    });
    const bare = Object.create(null) as { name: string; message: string };
    bare.name = '';
    bare.message = 'n';
    expect(exceptionsFromError(bare, mechanism, options).values[0]!.type).toBe('Error');
    const odd = { name: '', message: 'o', constructor: { name: 'Custom' } };
    expect(exceptionsFromError(odd, mechanism, options).values[0]!.type).toBe('Custom');
    const noFrames = err('E', 'x');
    noFrames.stack = 'E: x';
    expect(exceptionsFromError(noFrames, mechanism, options).values[0]!.stacktrace).toBeUndefined();
  });

  it('orders a cause chain oldest first with the captured error last', () => {
    const root = err('RootCause', 'db');
    const middle = err('Middle', 'repo', { cause: root });
    const top = err('Top', 'controller', { cause: middle });
    const { values } = exceptionsFromError(top, { type: 'onerror', handled: false }, options);
    expect(values.map((v) => v.type)).toEqual(['RootCause', 'Middle', 'Top']);
    expect(values[2]!.mechanism).toEqual({ type: 'onerror', handled: false, exception_id: 0 });
    expect(values[1]!.mechanism).toEqual({
      type: 'chained',
      source: 'cause',
      parent_id: 0,
      handled: false,
      exception_id: 1,
    });
    expect(values[0]!.mechanism).toMatchObject({ source: 'cause', parent_id: 1, exception_id: 2 });
  });

  it('caps the cause depth at 5 and ignores cycles and non-error causes', () => {
    let error = err('E0', 'x');
    for (let i = 1; i <= 8; i++) error = err(`E${i}`, 'x', { cause: error });
    expect(exceptionsFromError(error, mechanism, options).values).toHaveLength(6);
    const a = err('A', 'a');
    const b = err('B', 'b', { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(exceptionsFromError(b, mechanism, options).values).toHaveLength(2);
    expect(
      exceptionsFromError(err('C', 'c', { cause: 'text' }), mechanism, options).values,
    ).toHaveLength(1);
  });

  it('expands AggregateError children before the group', () => {
    const group = new AggregateError([err('One', '1'), 'skip', err('Two', '2')], 'many');
    group.stack = 'AggregateError: many\n    at g (https://app.test/g.js:1:1)';
    const { values } = exceptionsFromError(group, { type: 'generic' }, options);
    expect(values.map((v) => v.type)).toEqual(['Two', 'One', 'AggregateError']);
    expect(values[2]!.mechanism).toMatchObject({ is_exception_group: true, exception_id: 0 });
    expect(values[1]!.mechanism).toMatchObject({
      source: 'errors[0]',
      parent_id: 0,
      handled: true,
    });
    expect(values[0]!.mechanism).toMatchObject({ source: 'errors[2]' });
    const many = new AggregateError(
      Array.from({ length: 12 }, (_, i) => err(`E${i}`, 'x')),
      'm',
    );
    expect(exceptionsFromError(many, mechanism, options).values).toHaveLength(11);
  });

  it('serialises non-Error throws and rejections', () => {
    const thrown = exceptionsFromError({ code: 1, reason: 'x' }, { type: 'onerror' }, options);
    expect(thrown.values[0]!.value).toBe(
      'Non-Error exception captured: Object with keys: code, reason',
    );
    expect(thrown.serialized).toEqual({ code: 1, reason: 'x' });
    const rejected = exceptionsFromError('nope', { type: 'onunhandledrejection' }, options);
    expect(rejected.values[0]!.value).toBe('Non-Error promise rejection captured: nope');
    expect(exceptionsFromError(42, mechanism, options).values[0]!.value).toContain(': 42');
    expect(exceptionsFromError(null, mechanism, options).values[0]!.value).toContain(': null');
    expect(exceptionsFromError([], mechanism, options).values[0]!.value).toContain(
      'Array with keys: (none)',
    );
  });
});
