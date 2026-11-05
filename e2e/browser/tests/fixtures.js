// @ts-check
import { test as base, expect } from '@playwright/test';

export const BEACON = 'http://127.0.0.1:4200';
export const DSN =
  'http://bk_test_0000000000000000@127.0.0.1:4200/00000000-0000-4000-8000-000000000001';

export const test = base.extend({
  beacon: async ({ request }, use) => {
    await request.delete(`${BEACON}/__requests`);
    await request.post(`${BEACON}/__config`, { data: { rules: { rateLimits: false } } });
    const api = {
      requests: async () => await (await request.get(`${BEACON}/__requests`)).json(),
      script: async (...responses) => request.post(`${BEACON}/__script`, { data: responses }),
      events: async () =>
        (await api.requests()).flatMap((r) =>
          (r.envelope?.items ?? [])
            .filter((i) => i.header.type === 'event')
            .map((i) => ({ request: r, event: i.payload })),
        ),
      waitForEvents: async (count, timeout = 10_000) => {
        await expect
          .poll(async () => (await api.events()).length, { timeout })
          .toBeGreaterThanOrEqual(count);
        return api.events();
      },
    };
    await use(api);
  },
});

export { expect };

/** Throws asynchronously inside the page, so that it is a real uncaught error. */
export async function throwInPage(page, message) {
  await page.evaluate(
    (text) =>
      setTimeout(() => {
        throw new TypeError(text);
      }, 0),
    message,
  );
}
