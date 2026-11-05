import { truncate, wellFormed } from './utils.js';

export interface NormalizeLimits {
  depth: number;
  maxKeys: number;
  maxArray: number;
  maxString: number;
}

/** Limits for `extra` (contract §4.5). */
export const EXTRA_LIMITS: NormalizeLimits = {
  depth: 5,
  maxKeys: 100,
  maxArray: 100,
  maxString: 2048,
};

/**
 * Turns any value into a JSON-safe value within the given limits. Cycles become `[Circular]`, values past the depth
 * become `[Object]` / `[Array]`, strings are cut with `…`, and keys are made well-formed.
 */
export function normalize(value: unknown, limits: NormalizeLimits): unknown {
  return walk(value, limits, limits.depth, new WeakSet<object>());
}

function walk(
  value: unknown,
  limits: NormalizeLimits,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  switch (typeof value) {
    case 'string':
      return truncate(wellFormed(value), limits.maxString);
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'boolean':
      return value;
    case 'bigint':
      return `${value.toString()}n`;
    case 'symbol':
      return value.toString();
    case 'function':
      return `[Function: ${value.name || 'anonymous'}]`;
    case 'undefined':
      return undefined;
  }
  if (value === null) return null;
  const obj = value as object;
  if (seen.has(obj)) return '[Circular]';
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString();
  if (depth <= 0) return Array.isArray(obj) ? '[Array]' : '[Object]';
  seen.add(obj);
  let out: unknown;
  if (Array.isArray(obj)) {
    out = obj.slice(0, limits.maxArray).map((item) => {
      const normalized = walk(item, limits, depth - 1, seen);
      return normalized === undefined ? null : normalized;
    });
  } else {
    const source: Record<string, unknown> =
      obj instanceof Error
        ? { ...obj, name: obj.name, message: obj.message }
        : (obj as Record<string, unknown>);
    const result: Record<string, unknown> = {};
    let count = 0;
    for (const key of Object.keys(source)) {
      // Never copy keys that would reach a prototype.
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      if (count >= limits.maxKeys) break;
      const normalized = walk(source[key], limits, depth - 1, seen);
      if (normalized !== undefined) {
        result[wellFormed(key)] = normalized;
        count++;
      }
    }
    out = result;
  }
  seen.delete(obj);
  return out;
}
