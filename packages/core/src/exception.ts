import { normalize } from './normalize.js';
import { parseStack, toStacktrace, type FrameOptions } from './stack.js';
import type { ExceptionValue, Mechanism } from './types.js';
import { isErrorLike, truncate } from './utils.js';

export const MAX_CAUSE_DEPTH = 5;
export const MAX_AGGREGATE_ERRORS = 10;
export const MAX_VALUE_LENGTH = 8192;

export interface ExceptionResult {
  values: ExceptionValue[];
  /** Set for non-`Error` throws: `extra.__serialized__`. */
  serialized?: unknown;
}

function single(error: Error, options: FrameOptions): ExceptionValue {
  const value: ExceptionValue = {
    type: error.name || error.constructor?.name || 'Error',
    value: truncate(String(error.message), MAX_VALUE_LENGTH),
  };
  const stacktrace =
    typeof error.stack === 'string' ? toStacktrace(parseStack(error.stack), options) : undefined;
  if (stacktrace) value.stacktrace = stacktrace;
  return value;
}

function preview(value: unknown): string {
  if (typeof value === 'string') return truncate(value, 200);
  if (value === null || typeof value !== 'object') return truncate(String(value), 200);
  const keys = Object.keys(value);
  const name = Array.isArray(value) ? 'Array' : 'Object';
  return truncate(`${name} with keys: ${keys.join(', ') || '(none)'}`, 200);
}

/**
 * Builds `exception.values` in Sentry order (contract §3.3): the deepest `error.cause` first and the captured error
 * last. `AggregateError.errors` come before their group. Linked errors carry `exception_id` / `parent_id`.
 */
export function exceptionsFromError(
  error: unknown,
  mechanism: Mechanism,
  options: FrameOptions,
): ExceptionResult {
  if (!isErrorLike(error)) {
    const kind = mechanism.type === 'onunhandledrejection' ? 'promise rejection' : 'exception';
    return {
      values: [
        { type: 'Error', value: `Non-Error ${kind} captured: ${preview(error)}`, mechanism },
      ],
      serialized: normalize(error, { depth: 3, maxKeys: 50, maxArray: 50, maxString: 2048 }),
    };
  }
  const collected: ExceptionValue[] = [];
  const seen = new Set<unknown>();
  let nextId = 0;
  const visit = (err: Error, mech: Mechanism, depth: number): void => {
    seen.add(err);
    const id = nextId++;
    const value = single(err, options);
    value.mechanism = { ...mech, exception_id: id };
    collected.push(value);
    const children: Array<[Error, string]> = [];
    const errors = (err as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      value.mechanism.is_exception_group = true;
      errors.slice(0, MAX_AGGREGATE_ERRORS).forEach((child, i) => {
        if (isErrorLike(child)) children.push([child, `errors[${i}]`]);
      });
    }
    const cause = (err as { cause?: unknown }).cause;
    if (isErrorLike(cause)) children.push([cause, 'cause']);
    if (depth >= MAX_CAUSE_DEPTH) return;
    for (const [child, source] of children) {
      if (seen.has(child)) continue;
      visit(
        child,
        { type: 'chained', source, parent_id: id, handled: mech.handled ?? true },
        depth + 1,
      );
    }
  };
  visit(error, mechanism, 0);
  if (collected.length === 1) collected[0]!.mechanism = mechanism;
  return { values: collected.reverse() };
}
