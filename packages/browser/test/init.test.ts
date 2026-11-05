import { close, getClient, makeMemoryQueue } from '@nowo-tech/beacon-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPlatform, defaultBrowserIntegrations, init } from '../src/init.js';
import * as browser from '../src/index.js';
import * as delivery from '../src/delivery.js';
import { DSN, events, stubFetch, tick } from './helpers.js';

afterEach(async () => {
  await close(100);
  vi.unstubAllGlobals();
});

describe('init', () => {
  it('captures through the default integrations with the browser defaults', async () => {
    const { sent } = stubFetch();
    const client = init({ dsn: DSN, release: 'shop@1.0.0' });
    expect(client.integrations.map((i) => i.name)).toEqual([
      'GlobalHandlers',
      'ResourceErrors',
      'HttpErrors',
      'Breadcrumbs',
      'Dedupe',
      'BrowserContext',
      'Lifecycle',
    ]);
    const id = browser.captureException(new TypeError('boom'));
    await browser.flush(2000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.init.headers).toEqual({ 'Content-Type': 'text/plain;charset=UTF-8' });
    const header = JSON.parse(sent[0]!.body.split('\n')[0]!);
    expect(header).toMatchObject({
      event_id: id,
      dsn: DSN,
      sdk: { name: 'nowo.javascript.browser' },
    });
    expect(events(sent)[0]).toMatchObject({
      platform: 'javascript',
      release: 'shop@1.0.0',
      contexts: { browser: {} },
    });
  });

  it('refuses a server DSN with a warning and sends nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetch } = stubFetch();
    const client = init({
      dsn: 'https://pk:test-secret-not-real@beacon.test/00000000-0000-4000-8000-000000000001',
    });
    expect(client.isActive()).toBe(false);
    browser.captureMessage('x');
    await tick();
    expect(fetch).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]![0]).toContain('browser keys (bk_');
    expect(warn.mock.calls[0]![0]).not.toContain('test-secret-not-real');
  });

  it('builds integrations from options', () => {
    expect(defaultBrowserIntegrations().map((i) => i.name)).toContain('ResourceErrors');
    expect(
      defaultBrowserIntegrations({ dsn: DSN, resourceErrors: false }).map((i) => i.name),
    ).not.toContain('ResourceErrors');
    expect(
      defaultBrowserIntegrations({
        dsn: DSN,
        resourceErrors: 'event',
        failedRequestStatusCodes: [500],
      }),
    ).toHaveLength(7);
  });

  it('configures queue, online state and compression', async () => {
    stubFetch();
    expect(browserPlatform({ dsn: DSN }).defaultQueue!()).toBeUndefined();
    expect(browserPlatform({ dsn: DSN, offline: true }).defaultQueue!()).toBeDefined();
    const queue = makeMemoryQueue();
    expect(browserPlatform({ dsn: DSN, offline: queue }).defaultQueue!()).toBe(queue);
    expect(browserPlatform({ dsn: DSN }).isOnline!()).toBe(navigator.onLine);
    const platform = browserPlatform({ dsn: DSN });
    expect(platform.makeTransport({ dsn: DSN, compression: false })).toBeDefined();
    expect(platform.makeTransport({ dsn: DSN })).toBeDefined();
    expect(platform.validateDsn({ kind: 'browser' } as never)).toBeUndefined();
  });

  it('exports the delivery surface', () => {
    expect(delivery.init).toBe(init);
    expect(delivery.indexedDbQueue).toBeTypeOf('function');
    expect(delivery.BeaconReporter).toBeTypeOf('function');
    expect(browser.SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(getClient()).toBeUndefined();
  });
});
