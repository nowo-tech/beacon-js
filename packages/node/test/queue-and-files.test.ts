import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('file queue', () => {
  it('is FIFO, survives a new instance and writes 0600 files', async () => {
    const dir = fresh();
    const queue = makeFileQueue({ type: 'file', dir, now: () => 2000 });
    expect(await queue.peek()).toBeUndefined();
    expect(await queue.size()).toBe(0);
    await queue.push(envelope('b', 1000));
    await queue.push(envelope('a', 500));
    const files = readdirSync(dir);
    expect(files).toEqual([
      '1970-01-01T00-00-00-500Z-a.envelope',
      '1970-01-01T00-00-01-000Z-b.envelope',
    ]);
    expect(statSync(join(dir, files[0]!)).mode & 0o777).toBe(0o600);
    const restarted = makeFileQueue({ type: 'file', dir, now: () => 2000 });
    expect((await restarted.peek())!.id).toBe('a');
    await restarted.remove('a');
    expect((await restarted.peek())!.id).toBe('b');
    expect(await restarted.size()).toBe(1);
  });

  it('evicts the oldest over the file and byte caps', async () => {
    const queue = makeFileQueue({
      type: 'file',
      dir: fresh(),
      maxEnvelopes: 2,
      maxBytes: 400,
      now: () => 10,
    });
    expect(await queue.push(envelope('1', 1))).toBe(0);
    await queue.push(envelope('2', 2));
    expect(await queue.push(envelope('3', 3))).toBe(1);
    expect(await queue.push(envelope('4', 4, JSON.stringify('x'.repeat(300))))).toBe(2);
    expect(await queue.size()).toBe(1);
  });

  it('drops expired and corrupt files', async () => {
    const dir = fresh();
    const queue = makeFileQueue({ type: 'file', dir, ttlMs: 100, now: () => 1000 });
    await queue.push(envelope('old', 0));
    writeFileSync(join(dir, '0000-bad.envelope'), 'not json');
    writeFileSync(join(dir, '0001-noid.envelope'), '{}');
    writeFileSync(join(dir, 'ignored.txt'), 'x');
    await queue.push(envelope('new', 950));
    expect((await queue.peek())!.id).toBe('new');
    expect(await queue.size()).toBe(1);
    await queue.remove('missing');
  });

  it('survives unreadable entries', async () => {
    const dir = fresh();
    mkdirSync(join(dir, '0000-dir.envelope'), { recursive: true });
    symlinkSync(join(dir, 'nowhere'), join(dir, '0001-dangling.envelope'));
    const queue = makeFileQueue({ type: 'file', dir, now: () => 10 });
    await queue.push(envelope('ok', 5));
    expect((await queue.peek())!.id).toBe('ok');
  });

  it('has defaults', async () => {
    const queue = makeFileQueue({ type: 'file', dir: fresh() });
    await queue.push(envelope('d', Date.now()));
    expect((await queue.peek())!.id).toBe('d');
  });
});

describe('filenames', () => {
  const normalize = makeNodeFilenameNormalizer('/srv/app');
  it('makes paths relative to the app root', () => {
    expect(normalize('/srv/app/src/a.js')).toBe('src/a.js');
    expect(normalize('file:///srv/app/src/b.mjs')).toBe('src/b.mjs');
    expect(normalize('/other/lib.js')).toBe('/other/lib.js');
    expect(normalize('node:internal/process')).toBe('node:internal/process');
    expect(normalize('file://remote-host/x.js')).toBe('file://remote-host/x.js');
  });
});
