import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { events, run, startMock, waitFor } from './helpers.mjs';

let ctx;
before(async () => {
  ctx = await startMock();
});
after(() => ctx.mock.close());
beforeEach(() => ctx.mock.reset());

describe('Node process handling', () => {
  it('an uncaught exception reaches Beacon, then the process exits 1 within shutdownTimeoutMs + 500 ms', async () => {
    const started = Date.now();
    const { exited } = run('crash.mjs', { BEACON_DSN: ctx.dsn, SHUTDOWN_MS: '2000' });
    const result = await exited;
    assert.equal(result.code, 1, result.stderr);
    const [{ request, event }] = events(ctx.mock);
    assert.ok(request.time <= result.at, 'the envelope arrived before the exit');
    assert.ok(
      result.at - started < 2000 + 500 + 1500,
      `exit took ${result.at - started} ms (incl. process start)`,
    );
    assert.equal(event.level, 'fatal');
    assert.equal(event.exception.values.at(-1).mechanism.handled, false);
  });

  it('SIGTERM (opt-in) flushes before the default signal behaviour', async () => {
    const { child, exited, output } = run('sigterm.mjs', { BEACON_DSN: ctx.dsn });
    await waitFor(() => output().includes('ready'));
    child.kill('SIGTERM');
    const result = await exited;
    assert.equal(result.signal, 'SIGTERM');
    assert.equal(events(ctx.mock)[0].event.message, 'before sigterm');
  });

  it('the file queue survives a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'beacon-queue-'));
    try {
      ctx.mock.script({ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 });
      await run('queue.mjs', { BEACON_DSN: ctx.dsn, QUEUE_DIR: dir, PHASE: 'fail' }).exited;
      assert.ok(
        readdirSync(dir).some((f) => f.endsWith('.envelope')),
        'envelope kept on disk',
      );
      const firstId = ctx.mock.requests[0].envelope?.header.event_id;
      ctx.mock.reset();
      await run('queue.mjs', { BEACON_DSN: ctx.dsn, QUEUE_DIR: dir, PHASE: 'flush' }).exited;
      const flushed = events(ctx.mock);
      assert.equal(flushed.length, 1);
      assert.equal(flushed[0].event.message, 'queued while offline');
      if (firstId)
        assert.equal(flushed[0].request.envelope.header.event_id, firstId, 'same event_id');
      assert.equal(readdirSync(dir).filter((f) => f.endsWith('.envelope')).length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
