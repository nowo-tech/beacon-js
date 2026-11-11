// @ts-check
import { expect, test, throwInPage } from './fixtures.js';

const VERSIONED = '/api/ingest/v1/00000000-0000-4000-8000-000000000001/envelope/';
const LEGACY = '/api/00000000-0000-4000-8000-000000000001/envelope/';

test.describe('versioned ingest paths', () => {
  test('a current Beacon gets every envelope on the versioned path', async ({ page, beacon }) => {
    await page.goto('/index.html');
    await throwInPage(page, 'one');
    await beacon.waitForEvents(1);
    await throwInPage(page, 'two');
    await beacon.waitForEvents(2);
    const posts = (await beacon.requests()).filter((r) => r.method === 'POST');
    expect(posts.map((r) => [r.path, r.status])).toEqual([
      [VERSIONED, 200],
      [VERSIONED, 200],
    ]);
  });

  test('a legacy-only Beacon: one opaque 404, then the alias, and no envelope is sent twice', async ({
    page,
    beacon,
  }) => {
    await beacon.configure({ paths: 'legacy-only' });
    await page.goto('/index.html');
    await throwInPage(page, 'one');
    await beacon.waitForEvents(1);
    await throwInPage(page, 'two');
    const events = await beacon.waitForEvents(2);
    await page.waitForTimeout(500);
    const posts = (await beacon.requests()).filter((r) => r.method === 'POST');
    expect(posts.map((r) => [r.path, r.status])).toEqual([
      [VERSIONED, 404],
      [LEGACY, 200],
      [LEGACY, 200],
    ]);
    expect(events.map(({ event }) => event.exception.values.at(-1).value)).toEqual(['one', 'two']);
    expect(new Set(events.map(({ event }) => event.event_id)).size).toBe(2);
  });

  test('ingest-paths="legacy" never touches the versioned path', async ({ page, beacon }) => {
    await beacon.configure({ paths: 'legacy-only' });
    await page.goto('/blank.html');
    await page.evaluate(
      (dsn) => window.NowoBeacon.init({ dsn, ingestPaths: 'legacy' }),
      'http://bk_test_0000000000000000@127.0.0.1:4200/00000000-0000-4000-8000-000000000001',
    );
    await page.evaluate(() => window.NowoBeacon.captureMessage('forced'));
    await beacon.waitForEvents(1);
    const posts = (await beacon.requests()).filter((r) => r.method === 'POST');
    expect(posts.map((r) => r.path)).toEqual([LEGACY]);
  });
});
