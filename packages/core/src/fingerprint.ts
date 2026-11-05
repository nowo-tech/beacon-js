import type { BeaconEvent } from './types.js';

const DEFAULT_MARKERS = new Set(['{{ default }}', '{{default}}']);

/** Beacon's value normalisation for grouping (contract §0.5): UUIDs, 32-hex, digits and whitespace. */
export function normalizeGroupingValue(value: string): string {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{32}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The grouping inputs Beacon uses for an event: the last exception and its top `in_app` frame. */
export function groupingInputs(event: BeaconEvent): {
  type: string;
  value_normalised: string;
  filename: string;
  function: string;
} {
  const values = event.exception?.values ?? [];
  const last = values[values.length - 1];
  const frames = last?.stacktrace?.frames ?? [];
  const top = [...frames].reverse().find((frame) => frame.in_app) ?? frames[frames.length - 1];
  return {
    type: last?.type ?? '',
    value_normalised: normalizeGroupingValue(last?.value ?? String(event.message ?? '')),
    filename: top?.filename ?? '',
    function: top?.function ?? '',
  };
}

/**
 * Expands `{{ default }}` in a client fingerprint to the type, the normalised value and the top `in_app` frame of
 * the last exception, because Beacon hashes the array literally (contract §3.3). Mutates and returns the event.
 */
export function expandFingerprint(event: BeaconEvent): BeaconEvent {
  if (!event.fingerprint?.some((part) => DEFAULT_MARKERS.has(part))) return event;
  const inputs = groupingInputs(event);
  event.fingerprint = event.fingerprint.flatMap((part) =>
    DEFAULT_MARKERS.has(part)
      ? [inputs.type, inputs.value_normalised, `${inputs.filename}:${inputs.function}`]
      : [part],
  );
  return event;
}
