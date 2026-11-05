import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { QueuedEnvelope } from '@nowo-tech/beacon-core';
import { makeFileQueue } from '../src/file-queue.js';
import { makeNodeFilenameNormalizer } from '../src/filename.js';

const root = mkdtempSync(join(tmpdir(), 'beacon-queue-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = () => join(root, `q${n++}`);
const envelope = (id: string, createdAt: number, payload = '{}'): QueuedEnvelope => ({
  id,
  createdAt,
  category: 'error',
  eventId: id,
  header: { event_id: id },
  items: [{ type: 'event', payload }],
});

const hex = (n: number | string) => String(n).padStart(32, '0');
const name = (ms: number, id: string) =>
  `${new Date(ms).toISOString().replace(/[:.]/g, '-')}-${id}.envelope`;
const posix = process.platform !== 'win32';

describe('file queue', () => {
  it('is FIFO, survives a new instance and writes 0600 files', async () => {
    const dir = fresh();
    const queue = makeFileQueue({ type: 'file', dir, now: () => 2000 });
    expect(await queue.peek()).toBeUndefined();
    expect(await queue.size()).toBe(0);
    await queue.push(envelope(hex('b'), 1000));
    await queue.push(envelope(hex('a'), 500));
    const files = readdirSync(dir);
    expect(files).toEqual([name(500, hex('a')), name(1000, hex('b'))]);
    // POSIX permissions; Windows has no 0600 / 0700 modes.
    if (posix) {
      expect(statSync(join(dir, files[0]!)).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
    const restarted = makeFileQueue({ type: 'file', dir, now: () => 2000 });
    expect((await restarted.peek())!.id).toBe(hex('a'));
    await restarted.remove(hex('a'));
    expect((await restarted.peek())!.id).toBe(hex('b'));
    expect(await restarted.size()).toBe(1);
  });

  it('evicts the oldest over the file and byte caps', async () => {
    const queue = makeFileQueue({
      type: 'file',
      dir: fresh(),
      maxEnvelopes: 2,
      maxBytes: 500,
      now: () => 10,
    });
    expect(await queue.push(envelope(hex(1), 1))).toBe(0);
    await queue.push(envelope(hex(2), 2));
    expect(await queue.push(envelope(hex(3), 3))).toBe(1);
    expect(await queue.push(envelope(hex(4), 4, JSON.stringify('x'.repeat(400))))).toBe(2);
    expect(await queue.size()).toBe(1);
  });

  it('drops expired, corrupt and mismatched files, and ignores other names', async () => {
    const dir = fresh();
    const queue = makeFileQueue({ type: 'file', dir, ttlMs: 100, now: () => 1000 });
    await queue.push(envelope(hex('01d'), 0));
    writeFileSync(join(dir, name(1, hex('bad'))), 'not json');
    writeFileSync(join(dir, name(2, hex('a0'))), '{}');
    writeFileSync(join(dir, name(3, hex('b0'))), JSON.stringify(envelope(hex('c0'), 999)));
    writeFileSync(join(dir, 'ignored.envelope'), 'x');
    await queue.push(envelope(hex('e'), 950));
    expect((await queue.peek())!.id).toBe(hex('e'));
    expect(await queue.size()).toBe(1);
    expect(readdirSync(dir)).toContain('ignored.envelope');
    await queue.remove(hex('f'));
    await queue.remove('../../escape');
  });

  it('never writes outside its directory, whatever the envelope id (FV-L3)', async () => {
    const dir = fresh();
    const queue = makeFileQueue({ type: 'file', dir, now: () => 10 });
    await queue.push(envelope('../../../../fv-escaped', 5));
    expect(readdirSync(root).some((file) => file.includes('fv-escaped'))).toBe(false);
    const [file] = readdirSync(dir);
    expect(file).toMatch(/-[0-9a-f]{32}\.envelope$/);
    const stored = (await queue.peek())!;
    expect(stored.id).toMatch(/^[0-9a-f]{32}$/);
    await queue.remove(stored.id);
    expect(await queue.size()).toBe(0);
  });

  it.skipIf(!posix)(
    'never follows symlinks, refuses a symlinked directory and tightens an existing one',
    async () => {
      const dir = fresh();
      mkdirSync(dir, { mode: 0o755 });
      const target = join(root, `target-${n}`);
      writeFileSync(target, JSON.stringify(envelope(hex('5'), 5)));
      symlinkSync(target, join(dir, name(5, hex('5'))));
      const queue = makeFileQueue({ type: 'file', dir, now: () => 10 });
      await queue.push(envelope(hex('6'), 6));
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect((await queue.peek())!.id).toBe(hex('6'));
      expect(readFileSync(target, 'utf8')).toContain(hex('5'));
      const linked = join(root, `linked-${n++}`);
      symlinkSync(dir, linked);
      await expect(
        makeFileQueue({ type: 'file', dir: linked }).push(envelope(hex('7'), 7)),
      ).rejects.toThrow('real directory');
      const planted = fresh();
      mkdirSync(planted, { mode: 0o700 });
      symlinkSync(target, join(planted, name(8, hex('8'))));
      await expect(
        makeFileQueue({ type: 'file', dir: planted }).push(envelope(hex('8'), 8)),
      ).rejects.toThrow();
      expect(readFileSync(target, 'utf8')).toContain(hex('5'));
    },
  );

  it('survives unreadable entries', async () => {
    const dir = fresh();
    mkdirSync(join(dir, name(0, hex('d1'))), { recursive: true });
    const queue = makeFileQueue({ type: 'file', dir, now: () => 10 });
    await queue.push(envelope(hex('0c'), 5));
    expect((await queue.peek())!.id).toBe(hex('0c'));
  });

  it('has defaults', async () => {
    const queue = makeFileQueue({ type: 'file', dir: fresh() });
    await queue.push(envelope(hex('d'), Date.now()));
    expect((await queue.peek())!.id).toBe(hex('d'));
  });
});

describe('filenames', () => {
  // A real absolute root, so that the test holds on POSIX and on Windows (drive letters, backslashes).
  const root = resolve(tmpdir(), 'srv-app');
  const normalize = makeNodeFilenameNormalizer(root);
  it('makes paths relative to the app root', () => {
    expect(normalize(join(root, 'src', 'a.js'))).toBe('src/a.js');
    expect(normalize(pathToFileURL(join(root, 'src', 'b.mjs')).href)).toBe('src/b.mjs');
    const other = resolve(root, '..', 'other', 'lib.js');
    expect(normalize(other)).toBe(other.split(sep).join('/'));
    expect(normalize('node:internal/process')).toBe('node:internal/process');
    expect(normalize('file:///a%2Fb.js')).toBe('file:///a%2Fb.js');
  });
});
