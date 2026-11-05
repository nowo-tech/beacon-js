import { serializeLine } from './envelope.js';
import { EXTRA_LIMITS, normalize, type NormalizeLimits } from './normalize.js';
import { limitFrames, MAX_FRAMES } from './stack.js';
import type { BeaconEvent } from './types.js';
import { byteLength, truncate } from './utils.js';

export const MAX_MESSAGE_LENGTH = 16384;
export const MAX_BREADCRUMBS = 100;
export const MAX_TAGS = 50;
const DATA_LIMITS: NormalizeLimits = { depth: 5, maxKeys: 100, maxArray: 100, maxString: 2048 };

/** Field caps of contract §4.5, applied before the size check. Mutates and returns the event. */
export function applyCaps(event: BeaconEvent, maxBreadcrumbs: number): BeaconEvent {
  if (event.message !== undefined)
    event.message = truncate(String(event.message), MAX_MESSAGE_LENGTH);
  for (const value of event.exception?.values ?? []) {
    value.value = truncate(value.value, 8192);
    if (value.stacktrace && value.stacktrace.frames.length > MAX_FRAMES) {
      const limited = limitFrames(value.stacktrace.frames);
      value.stacktrace = { ...value.stacktrace, ...limited };
    }
  }
  if (event.breadcrumbs) {
    const limit = Math.min(Math.max(0, maxBreadcrumbs), MAX_BREADCRUMBS);
    const values = limit ? event.breadcrumbs.values.slice(-limit) : [];
    event.breadcrumbs = {
      values: values.map((crumb) =>
        crumb.data
          ? { ...crumb, data: normalize(crumb.data, DATA_LIMITS) as Record<string, unknown> }
          : crumb,
      ),
    };
  }
  if (event.extra) event.extra = normalize(event.extra, EXTRA_LIMITS) as Record<string, unknown>;
  if (event.contexts)
    event.contexts = normalize(event.contexts, DATA_LIMITS) as BeaconEvent['contexts'] & object;
  if (event.tags) {
    const tags: Record<string, string> = {};
    for (const [key, value] of Object.entries(event.tags).slice(0, MAX_TAGS)) {
      tags[truncate(key, 32)] = truncate(String(value), 200);
    }
    event.tags = tags;
  }
  return event;
}

export interface FitResult {
  event: BeaconEvent;
  line: string;
}

/**
 * Shrinks an event until its payload line fits `budget` bytes, dropping in order `extra`, the oldest breadcrumbs,
 * the source context and the frames from the middle (contract §4.5). Every step is listed in `extra.__truncated__`.
 * Returns `undefined` when the event cannot fit.
 */
export function fitEvent(event: BeaconEvent, budget: number): FitResult | undefined {
  let line = serializeLine(event);
  if (byteLength(line) <= budget) return { event, line };
  const steps: string[] = [];
  const step = (name: string): boolean => {
    steps.push(name);
    event.extra = { __truncated__: steps };
    line = serializeLine(event);
    return byteLength(line) <= budget;
  };
  if (event.extra && step('extra')) return { event, line };
  const crumbs = event.breadcrumbs?.values;
  if (crumbs?.length) {
    let over = byteLength(line) - budget + 64;
    let removed = 0;
    while (removed < crumbs.length && over > 0)
      over -= byteLength(serializeLine(crumbs[removed++])) + 1;
    event.breadcrumbs = { values: crumbs.slice(removed) };
    if (step(`breadcrumbs:${removed}`)) return { event, line };
  }
  const values = event.exception?.values ?? [];
  const withContext = values.some((value) =>
    value.stacktrace?.frames.some((frame) => frame.context_line !== undefined),
  );
  if (withContext) {
    for (const value of values) {
      for (const frame of value.stacktrace?.frames ?? []) {
        delete frame.pre_context;
        delete frame.context_line;
        delete frame.post_context;
      }
    }
    if (step('source_context')) return { event, line };
  }
  let dropped = 0;
  for (const value of values) {
    const stacktrace = value.stacktrace;
    while (stacktrace && stacktrace.frames.length > 2 && byteLength(line) > budget - 32) {
      stacktrace.frames.splice(Math.floor(stacktrace.frames.length / 2), 1);
      dropped++;
      line = serializeLine(event);
    }
  }
  if (dropped && step(`frames:${dropped}`)) return { event, line };
  return undefined;
}
