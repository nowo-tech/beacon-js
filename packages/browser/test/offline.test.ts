import { afterEach, describe, expect, it, vi } from 'vitest';
import { indexedDbQueue } from '../src/offline.js';
import type { QueuedEnvelope } from '@nowo-tech/beacon-core';

let counter = 0;
const name = () => `beacon-test-${Date.now()}-${counter++}`;
const envelope = (id: string, createdAt = Date.now(), payload = '{}'): QueuedEnvelope => ({
  id,
  createdAt,
  category: 'error',
  eventId: id,
  header: { event_id: id },
  items: [{ type: 'event', payload }],
});

afterEach(() => vi.unstubAllGlobals());

describe('IndexedDB queue', () => {
  it('is FIFO and survives a new queue instance on the same database', async () => {
    const db = name();
    const queue = indexedDbQueue({ name: db });
    expect(await queue.push(envelope('a'))).toBe(0);
    await queue.push(envelope('b'));
    const reopened = indexedDbQueue({ name: db });
    expect((await reopened.peek())!.id).toBe('a');
    await reopened.remove('a');
    expect((await reopened.peek())!.id).toBe('b');
    expect(await reopened.size()).toBe(1);
    await reopened.remove('missing');
  });

  it('drops the oldest over the caps', async () => {
    const queue = indexedDbQueue({ name: name(), maxEnvelopes: 2, maxBytes: 20 });
    await queue.push(envelope('a'));
    await queue.push(envelope('b'));
    expect(await queue.push(envelope('c'))).toBe(1);
    expect((await queue.peek())!.id).toBe('b');
    expect(await queue.push(envelope('d', Date.now(), '"0123456789012345678"'))).toBe(2);
    expect(await queue.size()).toBe(1);
  });

  it('expires envelopes after the TTL', async () => {
    let now = 1000;
    const queue = indexedDbQueue({ name: name(), ttlMs: 100, now: () => now });
    await queue.push(envelope('old', 1000));
    await queue.push(envelope('new', 1150));
    now = 1200;
    expect((await queue.peek())!.id).toBe('new');
    expect(await queue.size()).toBe(1);
    now = 5000;
    expect(await queue.peek()).toBeUndefined();
  });

  it('falls back to memory when IndexedDB is unavailable or fails', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('private mode');
      },
    });
    const queue = indexedDbQueue();
    await queue.push(envelope('m'));
    expect((await queue.peek())!.id).toBe('m');
    expect(await queue.size()).toBe(1);
    await queue.remove('m');
    expect(await queue.size()).toBe(0);
    const failing = {
      onerror: null as null | (() => void),
      onsuccess: null,
      onupgradeneeded: null,
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        setTimeout(() => failing.onerror!(), 0);
        return failing;
      },
    });
    const second = indexedDbQueue({ name: name() });
    expect(await second.push(envelope('n'))).toBe(0);
  });
});
