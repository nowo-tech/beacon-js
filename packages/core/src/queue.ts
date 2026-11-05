import type { Category } from './types.js';
import { byteLength } from './utils.js';

/** An envelope waiting to be (re)sent. `sent_at` is added at send time, so it is rewritten on every attempt. */
export interface QueuedEnvelope {
  id: string;
  createdAt: number;
  category: Category;
  eventId?: string;
  header: Record<string, unknown>;
  items: Array<{ type: string; payload: string }>;
}

/** FIFO store for envelopes that could not be sent yet (contract §4.4). */
export interface EnvelopeQueue {
  /** Adds an envelope at the tail. Resolves to the number of old envelopes evicted to make room. */
  push(envelope: QueuedEnvelope): Promise<number>;
  /** The oldest envelope that has not expired, if any. */
  peek(): Promise<QueuedEnvelope | undefined>;
  remove(id: string): Promise<void>;
  size(): Promise<number>;
}

export interface QueueLimits {
  maxEnvelopes: number;
  maxBytes: number;
  ttlMs: number;
}

export function envelopeBytes(envelope: QueuedEnvelope): number {
  return envelope.items.reduce((sum, item) => sum + byteLength(item.payload), 0);
}

/** In-memory queue, FIFO with oldest-dropped and a TTL. */
export function makeMemoryQueue(
  limits: QueueLimits = {
    maxEnvelopes: 100,
    maxBytes: 10 * 1024 * 1024,
    ttlMs: 7 * 24 * 3600 * 1000,
  },
  now: () => number = Date.now,
): EnvelopeQueue {
  let entries: Array<{ envelope: QueuedEnvelope; bytes: number }> = [];
  const expire = (): void => {
    const limit = now() - limits.ttlMs;
    entries = entries.filter((entry) => entry.envelope.createdAt > limit);
  };
  return {
    push(envelope) {
      expire();
      entries.push({ envelope, bytes: envelopeBytes(envelope) });
      let evicted = 0;
      let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
      while (
        entries.length > 1 &&
        (entries.length > limits.maxEnvelopes || total > limits.maxBytes)
      ) {
        total -= entries.shift()!.bytes;
        evicted++;
      }
      return Promise.resolve(evicted);
    },
    peek() {
      expire();
      return Promise.resolve(entries[0]?.envelope);
    },
    remove(id) {
      entries = entries.filter((entry) => entry.envelope.id !== id);
      return Promise.resolve();
    },
    size() {
      expire();
      return Promise.resolve(entries.length);
    },
  };
}
