import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import * as Beacon from '@nowo-tech/beacon-node';
import { PROJECT_ID } from '@beacon-js/mock-beacon';
import { startMock } from './helpers.mjs';

const VERSIONED = `/api/ingest/v1/${PROJECT_ID}/envelope/`;
const LEGACY = `/api/${PROJECT_ID}/envelope/`;

let current;
let legacyOnly;

before(async () => {
  current = await startMock();
  legacyOnly = await startMock({ paths: 'legacy-only' });
});

after(async () => {
  await Beacon.close(2000);
  await current.mock.close();
  await legacyOnly.mock.close();
});

beforeEach(() => Beacon.resetIngestPaths());

async function capture(ctx, options = {}) {
  await Beacon.close(2000);
  Beacon.init({ dsn: ctx.dsn, exitOnUncaught: false, unhandledRejections: 'warn', ...options });
  ctx.mock.reset();
  Beacon.captureMessage('first');
  await Beacon.flush(2000);
  Beacon.captureMessage('second');
  await Beacon.flush(2000);
  return ctx.mock.requests.map((r) => [r.path, r.status]);
}

describe('ingest paths → mock Beacon', () => {
  it('uses the versioned path on a current Beacon', async () => {
    assert.deepEqual(await capture(current), [
      [VERSIONED, 200],
      [VERSIONED, 200],
    ]);
  });

  it('falls back once on a legacy-only Beacon, then sends to the alias directly', async () => {
    assert.deepEqual(await capture(legacyOnly), [
      [VERSIONED, 404],
      [LEGACY, 200],
      [LEGACY, 200],
    ]);
    assert.equal(legacyOnly.mock.stats.events, 2, 'each event ingested exactly once');
  });

  it('ingestPaths: legacy never touches the versioned path', async () => {
    assert.deepEqual(await capture(legacyOnly, { ingestPaths: 'legacy' }), [
      [LEGACY, 200],
      [LEGACY, 200],
    ]);
  });

  it('ingestPaths: versioned never falls back', async () => {
    assert.deepEqual(await capture(legacyOnly, { ingestPaths: 'versioned' }), [
      [VERSIONED, 404],
      [VERSIONED, 404],
    ]);
  });
});
