import {
  Client,
  Scope,
  getCurrentScope,
  normalizeUrlFilename,
  type PlatformConfig,
} from '@nowo-tech/beacon-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { breadcrumbsIntegration, selectorOf } from '../src/integrations/breadcrumbs.js';
import { browserContextIntegration, parseUserAgent } from '../src/integrations/browser-context.js';
import { errorFromEvent, globalHandlersIntegration } from '../src/integrations/global-handlers.js';
import { httpErrorsIntegration } from '../src/integrations/http-errors.js';
import { lifecycleIntegration } from '../src/integrations/lifecycle.js';
import { resourceErrorsIntegration } from '../src/integrations/resource-errors.js';
import { envelopeDsnAuth, scrubUrl } from '@nowo-tech/beacon-core';
import { DSN, tick } from './helpers.js';

function fakeClient() {
  const platform: PlatformConfig = {
    platform: 'javascript',
    sdkName: 't',
    sdkVersion: '0',
    defaultIntegrations: [],
    defaultAuth: envelopeDsnAuth,
    makeTransport: () => ({
      send: () => Promise.resolve({ kind: 'ok' }),
      flush: () => Promise.resolve(true),
    }),
    validateDsn: () => undefined,
    onConfigError: 'warn',
    maxEnvelopeBytes: 200_000,
    lowerOnly: true,
    throttle: { perMinute: 100, burst: 100, refillPerSecond: 100 },
    identicalWindowMs: 0,
    inFlightCap: 10,
    normalizeFilename: normalizeUrlFilename,
  };
  const client = new Client({ dsn: DSN, integrations: [] }, platform);
  const captureException = vi.spyOn(client, 'captureException');
  const captureMessage = vi.spyOn(client, 'captureMessage');
  const addBreadcrumb = vi.spyOn(client, 'addBreadcrumb');
  return { client, captureException, captureMessage, addBreadcrumb };
}

/** Records the window listeners an integration adds, without dispatching real error events to the test runner. */
function listeners(): Map<string, (event: Event) => void> {
  const map = new Map<string, (event: Event) => void>();
  const original = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(
    (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      map.set(type, listener as (event: Event) => void);
      if (type !== 'error' && type !== 'unhandledrejection') original(type, listener, options);
    },
  );
  return map;
}

const teardowns: Array<() => void> = [];
function install<T extends { setup?: (c: Client) => void; teardown?: () => void }>(
  integration: T,
  client: Client,
): T {
  integration.setup?.(client);
  teardowns.push(() => integration.teardown?.());
  return integration;
}

beforeEach(() => {
  getCurrentScope().breadcrumbs = [];
});
afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
  vi.unstubAllGlobals();
});

describe('GlobalHandlers', () => {
  it('captures window errors and unhandled rejections', () => {
    const { client, captureException } = fakeClient();
    const handlers = listeners();
    install(globalHandlersIntegration(), client);
    const error = new TypeError('boom');
    handlers.get('error')!(new ErrorEvent('error', { error, message: 'boom' }));
    expect(captureException).toHaveBeenLastCalledWith(error, expect.any(Scope), undefined, {
      mechanism: { type: 'onerror', handled: false },
      logger: 'window.onerror',
    });
    handlers.get('unhandledrejection')!(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: 'nope',
      }),
    );
    expect(captureException).toHaveBeenLastCalledWith('nope', expect.any(Scope), undefined, {
      mechanism: { type: 'onunhandledrejection', handled: false },
      logger: 'window.onunhandledrejection',
    });
  });

  it('builds an error from events without one, and removes its listeners', () => {
    expect(errorFromEvent(new ErrorEvent('error', { message: 'Script error.' }))).toEqual({
      name: 'Error',
      message: 'Script error.',
      stack: 'Error: Script error.',
    });
    expect(
      errorFromEvent(
        new ErrorEvent('error', {
          message: 'x',
          filename: 'https://a.test/a.js',
          lineno: 3,
          colno: 4,
        }),
      ),
    ).toMatchObject({ stack: 'Error: x\n    at ? (https://a.test/a.js:3:4)' });
    expect(
      errorFromEvent(new ErrorEvent('error', { filename: 'https://a.test/a.js' })),
    ).toMatchObject({
      message: 'Unknown error',
      stack: 'Error: Unknown error\n    at ? (https://a.test/a.js:0:0)',
    });
    const { client } = fakeClient();
    const remove = vi.spyOn(window, 'removeEventListener');
    const integration = globalHandlersIntegration();
    integration.teardown!();
    integration.setup!(client);
    integration.teardown!();
    expect(remove.mock.calls.map(([type]) => type)).toEqual(['error', 'unhandledrejection']);
  });
});

describe('ResourceErrors', () => {
  it('records failed loads as breadcrumbs, skipping images by default', () => {
    const { client, addBreadcrumb } = fakeClient();
    const handlers = listeners();
    install(resourceErrorsIntegration(), client);
    const fire = (target: EventTarget | null) =>
      handlers.get('error')!({ target } as unknown as Event);
    const script = document.createElement('script');
    script.src = 'https://cdn.test/app.js?token=abc';
    fire(script);
    expect(addBreadcrumb).toHaveBeenCalledWith(
      {
        category: 'resource',
        level: 'error',
        message: '<script> failed to load',
        data: { url: 'https://cdn.test/app.js?token=[Filtered]', tag: 'script' },
      },
      expect.any(Scope),
    );
    fire(document.createElement('img'));
    fire(document.createElement('div'));
    fire(window);
    fire(null);
    const style = document.createElement('link');
    fire(style);
    expect(addBreadcrumb).toHaveBeenCalledTimes(2);
    expect(addBreadcrumb.mock.calls[1]![0].data).toEqual({ url: '', tag: 'link' });
  });

  it('can create warning events and include images', () => {
    const { client, captureMessage } = fakeClient();
    const handlers = listeners();
    install(resourceErrorsIntegration({ mode: 'event', images: true }), client);
    const fire = (target: EventTarget) => handlers.get('error')!({ target } as unknown as Event);
    const link = document.createElement('link');
    link.href = 'https://cdn.test/a.css';
    fire(link);
    expect(captureMessage).toHaveBeenCalledWith(
      'Failed to load <link> https://cdn.test/a.css',
      expect.any(Scope),
      'warning',
      { extra: { url: 'https://cdn.test/a.css', tag: 'link' } },
      { logger: 'resource' },
    );
    fire(document.createElement('img'));
    expect(captureMessage).toHaveBeenCalledTimes(2);
    resourceErrorsIntegration().teardown!();
  });
});

describe('HttpErrors', () => {
  it('records fetch breadcrumbs and events for failures, returning the original promise', async () => {
    const responses: Array<number | null> = [200, 404, 503, null, 200];
    const original = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => {
      const status = responses.shift();
      return status
        ? Promise.resolve(new Response(null, { status }))
        : Promise.reject(new TypeError('Failed to fetch'));
    });
    vi.stubGlobal('fetch', original);
    const { client, captureException, addBreadcrumb } = fakeClient();
    install(httpErrorsIntegration({ now: () => 5 }), client);
    expect(globalThis.fetch).not.toBe(original);
    await fetch('https://api.test/ok?code=1');
    await fetch(new URL('https://api.test/missing'), { method: 'post' });
    await fetch(new Request('https://api.test/down', { method: 'PUT' }));
    await expect(fetch('https://api.test/offline')).rejects.toThrow('Failed to fetch');
    await fetch('https://beacon.test/api/x/envelope/');
    await tick();
    expect(addBreadcrumb.mock.calls.map(([crumb]) => crumb)).toEqual([
      {
        category: 'fetch',
        type: 'http',
        level: 'info',
        data: {
          method: 'GET',
          url: 'https://api.test/ok?code=[Filtered]',
          duration: 0,
          status_code: 200,
        },
      },
      {
        category: 'fetch',
        type: 'http',
        level: 'warning',
        data: { method: 'POST', url: 'https://api.test/missing', duration: 0, status_code: 404 },
      },
      {
        category: 'fetch',
        type: 'http',
        level: 'error',
        data: { method: 'PUT', url: 'https://api.test/down', duration: 0, status_code: 503 },
      },
      {
        category: 'fetch',
        type: 'http',
        level: 'error',
        data: { method: 'GET', url: 'https://api.test/offline', duration: 0 },
      },
    ]);
    expect(captureException.mock.calls.map(([error]) => (error as Error).message)).toEqual([
      'PUT https://api.test/down responded 503',
      'GET https://api.test/offline failed (network error)',
    ]);
  });

  it('honours custom status ranges and restores fetch', async () => {
    const original = vi.fn(() => Promise.resolve(new Response(null, { status: 404 })));
    vi.stubGlobal('fetch', original);
    const { client, captureException } = fakeClient();
    const integration = httpErrorsIntegration({ failedRequestStatusCodes: [404, [400, 401]] });
    integration.setup!(client);
    await fetch('http://[invalid');
    await tick();
    expect(captureException).toHaveBeenCalledTimes(1);
    integration.teardown!();
    expect(globalThis.fetch).toBe(original);
    httpErrorsIntegration().teardown!();
  });

  it('wraps XMLHttpRequest', async () => {
    const { client, captureException, addBreadcrumb } = fakeClient();
    install(httpErrorsIntegration(), client);
    const load = (url: string) =>
      new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('get', url);
        xhr.addEventListener('loadend', () => resolve());
        xhr.send();
      });
    await load('/package.json');
    await load('http://127.0.0.1:1/unreachable');
    await load('https://beacon.test/api/x/envelope/');
    const plain = new XMLHttpRequest();
    expect(() => XMLHttpRequest.prototype.send.call(plain)).toThrow();
    const categories = addBreadcrumb.mock.calls.map(([crumb]) => [
      crumb.category,
      crumb.data!['status_code'],
    ]);
    expect(categories).toEqual([
      ['xhr', 200],
      ['xhr', undefined],
    ]);
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});

describe('Breadcrumbs', () => {
  it('records console warn/error and restores console', () => {
    const { client, addBreadcrumb } = fakeClient();
    const integration = breadcrumbsIntegration({
      dom: false,
      navigation: false,
      console: ['warn', 'error', 'info', 'debug', 'log'],
    });
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    integration.setup!(client);
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    console.warn('careful', { a: 1 }, undefined, circular);
    console.error('bad');
    console.info('i');
    console.debug('d');
    console.log('l');
    console.warn('[beacon] internal');
    expect(addBreadcrumb.mock.calls.map(([crumb]) => [crumb.level, crumb.message])).toEqual([
      ['warning', 'careful {"a":1} undefined [object Object]'],
      ['error', 'bad'],
      ['info', 'i'],
      ['debug', 'd'],
      ['info', 'l'],
    ]);
    expect(spy).toHaveBeenCalledWith('careful', { a: 1 }, undefined, circular);
    integration.teardown!();
    expect(console.warn).toBe(spy);
    breadcrumbsIntegration({ console: false, dom: false, navigation: false }).setup!(client);
  });

  it('records clicks and key presses with selectors only', () => {
    const { client, addBreadcrumb } = fakeClient();
    install(breadcrumbsIntegration({ console: false, navigation: false }), client);
    document.body.innerHTML =
      '<form id="f"><button type="button" id="save" class="primary big extra" name="x">Save secret</button><input name="q" value="hidden"></form>';
    const button = document.querySelector('button')!;
    const input = document.querySelector('input')!;
    button.click();
    input.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('click'));
    expect(addBreadcrumb.mock.calls.map(([crumb]) => [crumb.category, crumb.message])).toEqual([
      ['ui.click', 'html > body > form#f > button#save.primary.big[name="x"]'],
      ['ui.input', 'html > body > form#f > input[name="q"]'],
    ]);
    expect(JSON.stringify(addBreadcrumb.mock.calls)).not.toContain('hidden');
    expect(selectorOf(null)).toBe('');
  });

  it('adds element text when asked, never for inputs', () => {
    const { client, addBreadcrumb } = fakeClient();
    install(
      breadcrumbsIntegration({ console: false, navigation: false, dom: { text: true } }),
      client,
    );
    document.body.innerHTML = '<a>Open</a><span></span><textarea>secret</textarea>';
    document.querySelector('a')!.click();
    (document.querySelector('span') as HTMLElement).click();
    document.querySelector('textarea')!.click();
    expect(addBreadcrumb.mock.calls.map(([crumb]) => crumb.message)).toEqual([
      'html > body > a "Open"',
      'html > body > span',
      'html > body > textarea',
    ]);
  });

  it('records navigation and restores history', async () => {
    const { client, addBreadcrumb } = fakeClient();
    const originalPush = history.pushState;
    const integration = breadcrumbsIntegration({ console: false, dom: false });
    integration.setup!(client);
    const start = location.pathname + location.search;
    history.pushState({}, '', '/page?token=1');
    history.replaceState({}, '', '/other');
    history.replaceState({}, '');
    location.hash = 'section';
    await tick(20);
    dispatchEvent(new PopStateEvent('popstate'));
    history.pushState({}, '', start);
    expect(addBreadcrumb.mock.calls.map(([crumb]) => crumb.data)).toEqual([
      { from: scrubUrl(start), to: '/page?token=[Filtered]' },
      { from: '/page?token=[Filtered]', to: '/other' },
      { from: '/other', to: '/other' },
      { from: '/other', to: scrubUrl(start) },
    ]);
    integration.teardown!();
    expect(history.pushState).toBe(originalPush);
  });
});

describe('BrowserContext', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      'Edge',
      '131',
      'Windows',
    ],
    [
      'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Firefox',
      '132',
      'Linux',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      'Safari',
      '18',
      'macOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Safari',
      '17',
      'iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'Chrome',
      '130',
      'Android',
    ],
    [
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      'Chrome',
      '129',
      'Chrome OS',
    ],
  ])('parses %s', (ua, name, version, os) => {
    expect(parseUserAgent(ua)).toEqual({ browser: { name, version }, os: { name: os } });
  });

  it('handles unknown agents', () => {
    expect(parseUserAgent('curl/8')).toEqual({});
  });

  it('adds contexts and the page URL, preferring userAgentData', () => {
    const integration = browserContextIntegration();
    const event = integration.processEvent!(
      { contexts: { app: { a: 1 } } },
      {},
      undefined as never,
    )!;
    expect(event.contexts!['browser']).toBeDefined();
    expect(event.request).toEqual({
      url: location.href,
      headers: { 'User-Agent': navigator.userAgent },
    });
    vi.stubGlobal('navigator', {
      userAgent: 'curl/8',
      userAgentData: {
        brands: [
          { brand: 'Not A(Brand', version: '99' },
          { brand: 'Chromium', version: '131' },
          { brand: 'Google Chrome', version: '131' },
        ],
        platform: 'Linux',
      },
    });
    expect(
      integration.processEvent!({ request: { url: '/own' } }, {}, undefined as never),
    ).toMatchObject({
      contexts: { browser: { name: 'Chrome', version: '131' }, os: { name: 'Linux' } },
      request: { url: '/own' },
    });
    vi.stubGlobal('navigator', { userAgent: 'curl/8', userAgentData: { brands: [] } });
    expect(integration.processEvent!({}, {}, undefined as never)!.contexts).toEqual({});
  });
});

describe('Lifecycle', () => {
  it('flushes with unload on hide and pagehide, drains when online', () => {
    const { client } = fakeClient();
    const flush = vi.spyOn(client, 'flush').mockResolvedValue(true);
    const drain = vi.spyOn(client, 'drainQueue').mockResolvedValue();
    install(lifecycleIntegration(), client);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    dispatchEvent(new Event('pagehide'));
    dispatchEvent(new Event('online'));
    expect(flush.mock.calls).toEqual([
      [1000, true],
      [1000, true],
    ]);
    expect(drain).toHaveBeenCalledWith(false, true);
    lifecycleIntegration().teardown!();
  });
});
