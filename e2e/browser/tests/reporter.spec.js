// @ts-check
import { DSN, expect, test, throwInPage } from './fixtures.js';

test.describe('<beacon-reporter> from the IIFE', () => {
  test('a thrown error arrives as a simple request: text/plain, key in the envelope dsn, no preflight', async ({
    page,
    beacon,
  }) => {
    await page.goto('/index.html');
    await throwInPage(page, 'reporter boom');
    const [{ request, event }] = await beacon.waitForEvents(1);
    expect(request.status).toBe(200);
    expect(request.headers['content-type']).toBe('text/plain;charset=UTF-8');
    expect(request.headers['x-beacon-auth']).toBeUndefined();
    expect(request.headers.cookie).toBeUndefined();
    expect(request.headers.origin).toBe('http://127.0.0.1:4100');
    expect(request.query).toBe('');
    expect(request.envelope.header.dsn).toBe(DSN);
    expect(event).toMatchObject({
      platform: 'javascript',
      release: 'e2e@1.0.0',
      environment: 'e2e',
      level: 'error',
      logger: 'window.onerror',
    });
    const last = event.exception.values.at(-1);
    expect(last).toMatchObject({
      type: 'TypeError',
      value: 'reporter boom',
      mechanism: { type: 'onerror', handled: false },
    });
    expect(event.user?.ip_address).toBeUndefined();
    const all = await beacon.requests();
    expect(all.filter((r) => r.method === 'OPTIONS')).toHaveLength(0);
  });

  test('rejections, failed fetches, resource errors and navigation breadcrumbs', async ({
    page,
    beacon,
  }) => {
    await page.route('**/api/fail', (route) => route.fulfill({ status: 500, body: 'no' }));
    await page.route('**/api/offline', (route) => route.abort('failed'));
    await page.goto('/index.html');
    await page.evaluate(() => {
      const img = document.createElement('script');
      img.src = '/missing-script.js';
      document.body.append(img);
      history.pushState({}, '', '/checkout?code=secret');
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      void Promise.reject(new Error('rejected promise'));
    });
    await page.evaluate(() => fetch('/api/fail'));
    await page.evaluate(() => fetch('/api/offline').catch(() => undefined));
    const events = await beacon.waitForEvents(3);
    const values = events.map(({ event }) => event.exception.values.at(-1).value);
    expect(values).toEqual(
      expect.arrayContaining([
        'rejected promise',
        'GET /api/fail responded 500',
        expect.stringMatching(/GET \/api\/offline failed/),
      ]),
    );
    const rejection = events.find(
      ({ event }) => event.exception.values.at(-1).value === 'rejected promise',
    ).event;
    expect(rejection.exception.values.at(-1).mechanism.type).toBe('onunhandledrejection');
    const crumbs = rejection.breadcrumbs.values;
    expect(crumbs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'resource',
          data: expect.objectContaining({ tag: 'script' }),
        }),
        expect.objectContaining({
          category: 'navigation',
          data: { from: '/index.html', to: '/checkout?code=[Filtered]' },
        }),
      ]),
    );
  });

  test('a 429 with Retry-After N blocks every request for N seconds', async ({ page, beacon }) => {
    await beacon.script({
      status: 429,
      headers: { 'Retry-After': '3', 'X-Beacon-Rate-Limit': 'key' },
    });
    await page.goto('/index.html');
    await throwInPage(page, 'first');
    await expect.poll(async () => (await beacon.requests()).length).toBe(1);
    const limitedAt = Date.now();
    await throwInPage(page, 'second');
    await page.waitForTimeout(2500);
    expect(await beacon.requests()).toHaveLength(1);
    await page.waitForTimeout(Math.max(0, 3200 - (Date.now() - limitedAt)));
    await throwInPage(page, 'third');
    const events = await beacon.waitForEvents(2);
    expect(events.map(({ request }) => request.status)).toEqual([429, 200]);
    expect(events.map(({ event }) => event.exception.values.at(-1).value)).toEqual([
      'first',
      'third',
    ]);
    expect(await page.evaluate(() => window.NowoBeacon.getClient().lastRateLimit)).toBe('key');
  });

  test('a render loop of 1000 errors per second stays under 30 requests a minute', async ({
    page,
    beacon,
  }) => {
    await page.goto('/index.html');
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          let i = 0;
          const timer = setInterval(() => {
            for (let n = 0; n < 10; n++)
              window.NowoBeacon.captureException(new Error(`loop ${i++}`));
          }, 10);
          setTimeout(() => {
            clearInterval(timer);
            resolve(undefined);
          }, 3000);
        }),
    );
    await page.waitForTimeout(500);
    const requests = await beacon.requests();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.length).toBeLessThanOrEqual(7);
  });

  test('pending data is delivered with sendBeacon on pagehide', async ({ page, beacon }) => {
    await page.goto('/index.html');
    await page.evaluate(() => window.NowoBeacon.getClient().discard('sample_rate'));
    await page.goto('/other.html');
    await expect
      .poll(
        async () =>
          (await beacon.requests()).filter(
            (r) => r.envelope?.items[0]?.header.type === 'client_report',
          ).length,
      )
      .toBe(1);
    const report = (await beacon.requests()).find(
      (r) => r.envelope?.items[0]?.header.type === 'client_report',
    );
    expect(report.headers['content-type']).toMatch(/^text\/plain;charset=utf-8$/i);
    expect(report.envelope.items[0].payload.discarded_events).toEqual([
      { reason: 'sample_rate', category: 'error', quantity: 1 },
    ]);
  });

  test('a refused origin gets no CORS, and the client backs off instead of retrying in a loop', async ({
    page,
    beacon,
  }) => {
    await page.goto('http://localhost:4100/index.html');
    await throwInPage(page, 'refused 1');
    await expect.poll(async () => (await beacon.requests()).length).toBe(1);
    const [refused] = await beacon.requests();
    expect(refused.status).toBe(403);
    await throwInPage(page, 'refused 2');
    await throwInPage(page, 'refused 3');
    await page.waitForTimeout(2000);
    expect(await beacon.requests()).toHaveLength(1);
  });
});

test.describe('programmatic API', () => {
  test('offline then online flushes the queue in order with the same event_id', async ({
    page,
    context,
    beacon,
  }) => {
    await page.goto('/blank.html');
    await page.evaluate((dsn) => window.NowoBeacon.init({ dsn, offline: true }), DSN);
    await context.setOffline(true);
    const ids = await page.evaluate(() => [
      window.NowoBeacon.captureMessage('offline one'),
      window.NowoBeacon.captureMessage('offline two'),
    ]);
    await page.waitForTimeout(500);
    expect(await beacon.requests()).toHaveLength(0);
    await context.setOffline(false);
    const events = await beacon.waitForEvents(2);
    expect(events.map(({ event }) => event.event_id)).toEqual(ids);
    expect(events.map(({ event }) => event.message)).toEqual(['offline one', 'offline two']);
  });

  test('a strict CSP page loads the IIFE with SRI and reports without violations', async ({
    page,
    beacon,
  }) => {
    const csp =
      "default-src 'none'; script-src 'self'; connect-src http://127.0.0.1:4200; base-uri 'none'";
    const violations = [];
    page.on('console', (message) => {
      // Browser-internal favicon requests are not the page's; everything else counts.
      if (/Content.Security.Policy|CSP/i.test(message.text()) && !/favicon/i.test(message.text()))
        violations.push(message.text());
    });
    const response = await page.goto(`/csp.html?csp=${encodeURIComponent(csp)}`);
    expect(response.headers()['content-security-policy']).toBe(csp);
    await page.evaluate(() =>
      document.addEventListener(
        'securitypolicyviolation',
        () => (window.__csp = (window.__csp ?? 0) + 1),
      ),
    );
    expect(await page.evaluate(() => document.querySelector('script').integrity)).toMatch(
      /^sha384-/,
    );
    expect(await page.evaluate(() => typeof window.NowoBeacon)).toBe('object');
    await throwInPage(page, 'csp boom');
    const [{ event }] = await beacon.waitForEvents(1);
    expect(event.release).toBe('csp@1');
    expect(await page.evaluate(() => window.__csp ?? 0)).toBe(0);
    expect(violations).toEqual([]);
  });

  test('the browser build refuses a DSN with a secret and sends nothing', async ({
    page,
    beacon,
  }) => {
    await page.goto('/blank.html');
    const warnings = [];
    page.on('console', (message) => warnings.push(message.text()));
    await page.evaluate(() => {
      window.NowoBeacon.init({
        dsn: 'http://test-public:test-secret-not-real@127.0.0.1:4200/00000000-0000-4000-8000-000000000001',
      });
      window.NowoBeacon.captureMessage('must not be sent');
    });
    await page.waitForTimeout(500);
    expect(await beacon.requests()).toHaveLength(0);
    expect(warnings.join('\n')).toContain('browser keys');
    expect(warnings.join('\n')).not.toContain('test-secret-not-real');
  });
});
