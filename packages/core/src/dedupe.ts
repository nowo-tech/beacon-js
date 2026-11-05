import type { Integration } from './client.js';
import type { BeaconEvent } from './types.js';

/** The dedupe key (contract §4.6): type, value and the top three frames, or the message. */
export function dedupeKey(event: BeaconEvent): string {
  const values = event.exception?.values;
  const last = values?.[values.length - 1];
  if (!last) return `message|${String(event.message ?? '')}`;
  const frames = (last.stacktrace?.frames ?? [])
    .slice(-3)
    .map(
      (frame) =>
        `${frame.filename ?? ''}:${frame.lineno ?? ''}:${frame.colno ?? ''}:${frame.function ?? ''}`,
    );
  return `${last.type}|${last.value}|${frames.join('|')}`;
}

/** Drops an event equal to the previous one within `windowMs` (default 5 s). On by default. */
export function dedupeIntegration(windowMs = 5000, now: () => number = Date.now): Integration {
  let previous: { key: string; at: number } | undefined;
  return {
    name: 'Dedupe',
    processEvent(event) {
      const key = dedupeKey(event);
      const at = now();
      if (previous && previous.key === key && at - previous.at < windowMs) return null;
      previous = { key, at };
      return event;
    },
  };
}
