import { byteLength, wellFormed } from './utils.js';

export interface EnvelopeItem {
  type: string;
  /** The payload, already serialised as one JSON line (see {@link serializeLine}). */
  payload: string;
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'string') return wellFormed(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.some((key) => wellFormed(key) !== key)) {
      const out: Record<string, unknown> = {};
      for (const key of keys) out[wellFormed(key)] = (value as Record<string, unknown>)[key];
      return out;
    }
  }
  return value;
}

/** Serialises a value as one JSON line: no indentation, lone surrogates replaced, never a raw newline. */
export function serializeLine(value: unknown): string {
  return assertSingleLine(JSON.stringify(value, replacer));
}

function assertSingleLine(line: string): string {
  if (line.includes('\n') || line.includes('\r')) {
    throw new Error('beacon: an envelope line contains a raw newline');
  }
  return line;
}

/**
 * Encodes a Sentry-compatible envelope (contract §3.1): the header line, then for each item an item header with the
 * exact UTF-8 `length` of its payload and the payload line. Lines are separated by `\n`, with no trailing newline.
 */
export function encodeEnvelope(
  header: Record<string, unknown>,
  items: readonly EnvelopeItem[],
): string {
  const lines = [serializeLine(header)];
  for (const item of items) {
    const payload = assertSingleLine(item.payload);
    lines.push(serializeLine({ type: item.type, length: byteLength(payload) }), payload);
  }
  return lines.join('\n');
}
