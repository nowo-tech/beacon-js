import { describe, expect, it } from 'vitest';
import { envelopeBytes, makeMemoryQueue, type QueuedEnvelope } from '../src/queue.js';

const envelope = (id: string, createdAt = 0, payload = '{}'): QueuedEnvelope => ({
  id,
  createdAt,
  category: 'error',
  header: {},
  items: [{ type: 'event', payload }],
});

describe('memory queue', () => {
  it('is FIFO with remove', async () => {
    const queue = makeMemoryQueue(undefined, () => 0);
    expect(await queue.push(envelope('a'))).toBe(0);
    await queue.push(envelope('b'));
    expect((await queue.peek())!.id).toBe('a');
    await queue.remove('a');
    expect((await queue.peek())!.id).toBe('b');
    expect(await queue.size()).toBe(1);
  });

  it('drops the oldest over the count and byte caps', async () => {
    const queue = makeMemoryQueue({ maxEnvelopes: 2, maxBytes: 10, ttlMs: 1000 }, () => 0);
    await queue.push(envelope('a'));
    await queue.push(envelope('b'));
    expect(await queue.push(envelope('c'))).toBe(1);
    expect((await queue.peek())!.id).toBe('b');
    expect(await queue.push(envelope('d', 0, '"0123456789"'))).toBe(2);
    expect(await queue.size()).toBe(1);
    expect(envelopeBytes(envelope('x', 0, 'ñ'))).toBe(2);
  });

  it('expires envelopes after the TTL', async () => {
    let now = 0;
    const queue = makeMemoryQueue({ maxEnvelopes: 5, maxBytes: 1000, ttlMs: 100 }, () => now);
    await queue.push(envelope('a', 0));
    now = 200;
    expect(await queue.peek()).toBeUndefined();
    expect(await queue.size()).toBe(0);
  });

  it('has sane defaults', async () => {
    const queue = makeMemoryQueue();
    await queue.push(envelope('a', Date.now()));
    expect(await queue.size()).toBe(1);
  });
});
