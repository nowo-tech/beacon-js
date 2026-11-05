import {
  makeMemoryQueue,
  type EnvelopeQueue,
  type QueuedEnvelope,
  type QueueLimits,
} from '@nowo-tech/beacon-core';

export interface IndexedDbQueueOptions extends Partial<QueueLimits> {
  /** Database name (default `nowo-beacon`). */
  name?: string;
  now?: () => number;
}

interface StoredEnvelope {
  seq?: number;
  id: string;
  createdAt: number;
  bytes: number;
  envelope: QueuedEnvelope;
}

const STORE = 'envelopes';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    // IndexedDB request failures (quota, aborted transactions) cannot be triggered deterministically in tests.
    /* v8 ignore next */
    req.onerror = () => reject(req.error);
  });
}

/** The browser defaults: 30 envelopes, 1 MiB, 7 days. */
export const BROWSER_QUEUE_LIMITS: QueueLimits = {
  maxEnvelopes: 30,
  maxBytes: 1024 * 1024,
  ttlMs: 7 * 24 * 3600 * 1000,
};

/**
 * Persistent offline queue in IndexedDB (contract §4.4): FIFO with oldest-dropped, a 30-envelope / 1 MiB cap and a
 * 7-day TTL. Falls back to memory when IndexedDB is unavailable (private mode).
 */
export function indexedDbQueue(options: IndexedDbQueueOptions = {}): EnvelopeQueue {
  const limits: QueueLimits = { ...BROWSER_QUEUE_LIMITS, ...options };
  const now = options.now ?? Date.now;
  const fallback = makeMemoryQueue(limits, now);
  let db: Promise<IDBDatabase | undefined> | undefined;

  const open = (): Promise<IDBDatabase | undefined> =>
    (db ??= new Promise<IDBDatabase | undefined>((resolve) => {
      try {
        const req = indexedDB.open(options.name ?? 'nowo-beacon', 1);
        req.onupgradeneeded = () => {
          req.result
            .createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true })
            .createIndex('id', 'id');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    }));

  /** Walks the store oldest first; `visit` returns true to delete the record. */
  const walk = (
    store: IDBObjectStore,
    visit: (record: StoredEnvelope) => boolean | 'stop',
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const cursorRequest = store.openCursor();
      // See `request()`: cursor failures cannot be triggered deterministically.
      /* v8 ignore next */
      cursorRequest.onerror = () => reject(cursorRequest.error);
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return resolve();
        const verdict = visit(cursor.value as StoredEnvelope);
        if (verdict === 'stop') return resolve();
        if (verdict) cursor.delete();
        cursor.continue();
      };
    });

  const withStore = async <T>(
    fallbackCall: () => Promise<T>,
    call: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> => {
    const database = await open();
    if (!database) return fallbackCall();
    const tx = database.transaction(STORE, 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      // See `request()`: transaction failures cannot be triggered deterministically.
      /* v8 ignore next */
      tx.onerror = () => reject(tx.error);
    });
    const result = await call(tx.objectStore(STORE));
    await done;
    return result;
  };

  return {
    push: (envelope) =>
      withStore(
        () => fallback.push(envelope),
        async (store) => {
          const bytes = envelope.items.reduce((sum, item) => sum + item.payload.length, 0);
          await request(
            store.add({ id: envelope.id, createdAt: envelope.createdAt, bytes, envelope }),
          );
          const records: StoredEnvelope[] = [];
          await walk(store, (record) => {
            records.push(record);
            return false;
          });
          let total = records.reduce((sum, record) => sum + record.bytes, 0);
          let evict = 0;
          while (
            records.length - evict > 1 &&
            (records.length - evict > limits.maxEnvelopes || total > limits.maxBytes)
          ) {
            total -= records[evict]!.bytes;
            evict++;
          }
          let seen = 0;
          if (evict) await walk(store, () => (seen++ < evict ? true : 'stop'));
          return evict;
        },
      ),
    peek: () =>
      withStore(
        () => fallback.peek(),
        async (store) => {
          const limit = now() - limits.ttlMs;
          let found: QueuedEnvelope | undefined;
          await walk(store, (record) => {
            if (record.createdAt <= limit) return true;
            found = record.envelope;
            return 'stop';
          });
          return found;
        },
      ),
    remove: (id) =>
      withStore(
        () => fallback.remove(id),
        async (store) => {
          const keys = await request(store.index('id').getAllKeys(id));
          await Promise.all(keys.map((key) => request(store.delete(key))));
        },
      ),
    size: () =>
      withStore(
        () => fallback.size(),
        (store) => request(store.count()),
      ),
  };
}
