import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EnvelopeQueue, QueuedEnvelope } from '@nowo-tech/beacon-core';

export interface FileQueueOptions {
  type: 'file';
  /** Directory for the envelope files (created with mode 0700). */
  dir: string;
  /** Default 100. */
  maxEnvelopes?: number;
  /** Default 10 MiB. */
  maxBytes?: number;
  /** Default 7 days. */
  ttlMs?: number;
  now?: () => number;
}

const SUFFIX = '.envelope';

/**
 * A file-backed queue (contract §4.4): one `<sent_at>-<event_id>.envelope` file per envelope, mode 0600, FIFO with
 * oldest-dropped at 100 files / 10 MiB. It survives a restart and is flushed on start.
 */
export function makeFileQueue(options: FileQueueOptions): EnvelopeQueue {
  const maxEnvelopes = options.maxEnvelopes ?? 100;
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const ttlMs = options.ttlMs ?? 7 * 24 * 3600 * 1000;
  const now = options.now ?? Date.now;
  const dir = options.dir;

  const list = async (): Promise<string[]> => {
    try {
      return (await readdir(dir)).filter((name) => name.endsWith(SUFFIX)).sort();
    } catch {
      return [];
    }
  };
  const drop = (name: string): Promise<void> => unlink(join(dir, name)).catch(() => undefined);

  return {
    async push(envelope) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const stamp = new Date(envelope.createdAt).toISOString().replace(/[:.]/g, '-');
      const name = `${stamp}-${envelope.id}${SUFFIX}`;
      await writeFile(join(dir, name), JSON.stringify(envelope), { mode: 0o600 });
      const files = await Promise.all(
        (await list()).map((file) =>
          stat(join(dir, file)).then(
            (s) => ({ file, size: s.size }),
            () => ({ file, size: 0 }),
          ),
        ),
      );
      let total = files.reduce((sum, entry) => sum + entry.size, 0);
      let evicted = 0;
      for (const entry of files) {
        const left = files.length - evicted;
        if (left <= 1 || (left <= maxEnvelopes && total <= maxBytes)) break;
        total -= entry.size;
        await drop(entry.file);
        evicted++;
      }
      return evicted;
    },
    async peek() {
      for (const name of await list()) {
        let envelope: QueuedEnvelope | undefined;
        try {
          envelope = JSON.parse(await readFile(join(dir, name), 'utf8')) as QueuedEnvelope;
        } catch {
          envelope = undefined;
        }
        if (envelope && typeof envelope.id === 'string' && envelope.createdAt > now() - ttlMs)
          return envelope;
        await drop(name);
      }
      return undefined;
    },
    async remove(id) {
      for (const name of await list()) {
        if (name.endsWith(`-${id}${SUFFIX}`)) await drop(name);
      }
    },
    async size() {
      return (await list()).length;
    },
  };
}
