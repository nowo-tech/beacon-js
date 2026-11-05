import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { EVENT_ID, uuid4, type EnvelopeQueue, type QueuedEnvelope } from '@nowo-tech/beacon-core';

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
/** Symlinks are never followed (O_NOFOLLOW where the platform has it; Windows has no such flag). */
// Platform-dependent: the `?? 0` side only runs on Windows.
/* v8 ignore next */
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const FILE_NAME = /^[0-9TZ-]+-[0-9a-f]{32}\.envelope$/;

async function readNoFollow(path: string): Promise<string> {
  // Checked on the open handle itself, so that nothing can be swapped between the check and the read.
  const handle = await open(path, constants.O_RDONLY | NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('not a regular file');
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

async function writeNoFollow(path: string, data: string): Promise<void> {
  // O_EXCL: never write through an existing name, symlink or not.
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
}

/** Creates the directory (0700) and refuses a symlinked one; an existing directory is tightened to 0700. */
async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory()) throw new Error('the queue directory must be a real directory');
  if (process.platform !== 'win32' && (info.mode & 0o777) !== 0o700) await chmod(dir, 0o700);
}

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
      return (await readdir(dir)).filter((name) => FILE_NAME.test(name)).sort();
    } catch {
      return [];
    }
  };
  const drop = (name: string): Promise<void> => unlink(join(dir, name)).catch(() => undefined);

  return {
    async push(envelope) {
      await ensureDir(dir);
      // Only Beacon's id format ever names a file, so nothing can escape the directory (FV-L3).
      const stored = EVENT_ID.test(envelope.id) ? envelope : { ...envelope, id: uuid4() };
      const stamp = new Date(stored.createdAt).toISOString().replace(/[:.]/g, '-');
      await writeNoFollow(join(dir, `${stamp}-${stored.id}${SUFFIX}`), JSON.stringify(stored));
      const files = await Promise.all(
        (await list()).map((file) =>
          lstat(join(dir, file)).then(
            (s) => ({ file, size: s.size }),
            // A file removed between readdir and lstat (another process draining): a race tests cannot pin down.
            /* v8 ignore next */
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
          envelope = JSON.parse(await readNoFollow(join(dir, name))) as QueuedEnvelope;
        } catch {
          envelope = undefined;
        }
        if (
          envelope &&
          EVENT_ID.test(String(envelope.id)) &&
          name.endsWith(`-${envelope.id}${SUFFIX}`) &&
          envelope.createdAt > now() - ttlMs
        )
          return envelope;
        await drop(name);
      }
      return undefined;
    },
    async remove(id) {
      if (!EVENT_ID.test(id)) return;
      for (const name of await list()) {
        if (name.endsWith(`-${id}${SUFFIX}`)) await drop(name);
      }
    },
    async size() {
      return (await list()).length;
    },
  };
}
