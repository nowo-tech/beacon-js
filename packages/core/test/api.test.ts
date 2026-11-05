import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/api.js';
import type { Scope } from '../src/scope.js';
import { BROWSER_DSN, eventOf, platform, recordingTransport } from './helpers.js';

afterEach(async () => {
  await api.close(10);
  api.setAsyncContextStrategy(undefined);
});

describe('global API', () => {
  it('is a no-op before init', async () => {
    expect(api.getClient()).toBeUndefined();
    expect(api.captureException(new Error('x'))).toBe('');
    expect(api.captureMessage('x')).toBe('');
    api.addBreadcrumb({ message: 'x' });
    expect(await api.flush()).toBe(true);
    expect(await api.close()).toBe(true);
  });

  it('captures through the global client with scope data', async () => {
    const transport = recordingTransport();
    api.initClient(
      { dsn: BROWSER_DSN, transport, initialScope: { tags: { init: '1' } } },
      platform(),
    );
    api.setUser({ id: 'u' });
    api.setTag('a', 'b');
    api.setTags({ c: 'd' });
    api.setExtra('e', 1);
    api.setContext('ctx', { k: 1 });
    api.addBreadcrumb({ message: 'crumb' });
    const id = api.captureException(new Error('boom'), { level: 'fatal' });
    expect(api.lastEventId()).toBe(id);
    api.capture('a message', { level: 'warning' });
    api.capture('plain');
    api.capture(new Error('err'));
    api.captureMessage('m');
    await api.flush(1000);
    const event = eventOf(transport.requests[0]!);
    expect(event).toMatchObject({
      level: 'fatal',
      user: { id: 'u' },
      tags: { init: '1', a: 'b', c: 'd' },
      extra: { e: 1 },
      contexts: { ctx: { k: 1 } },
    });
    expect(event['breadcrumbs'].values[0].message).toBe('crumb');
    expect(eventOf(transport.requests[1]!)).toMatchObject({
      message: 'a message',
      level: 'warning',
    });
    expect(eventOf(transport.requests[2]!)).toMatchObject({ message: 'plain', level: 'info' });
    api.setContext('ctx', null);
    api.setUser(null);
  });

  it('forks scopes with withScope, also under an async strategy', () => {
    const transport = recordingTransport();
    api.initClient({ dsn: BROWSER_DSN, transport }, platform());
    const outer = api.getCurrentScope();
    const result = api.withScope((scope) => {
      expect(api.getCurrentScope()).toBe(scope);
      scope.setTag('inner', '1');
      return 42;
    });
    expect(result).toBe(42);
    expect(api.getCurrentScope()).toBe(outer);
    expect(outer.tags['inner']).toBeUndefined();
    expect(() =>
      api.withScope(() => {
        throw new Error('x');
      }),
    ).toThrow('x');
    expect(api.getCurrentScope()).toBe(outer);
    let current: Scope | undefined;
    api.setAsyncContextStrategy({
      getScope: () => current,
      withScope: (scope, callback) => {
        const previous = current;
        current = scope;
        try {
          return callback();
        } finally {
          current = previous;
        }
      },
    });
    expect(api.getCurrentScope()).toBe(outer);
    api.withScope((scope) => expect(api.getCurrentScope()).toBe(scope));
  });

  it('replaces the client on a second init with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const teardown = vi.fn();
    const first = api.initClient(
      { dsn: BROWSER_DSN, transport: recordingTransport() },
      platform({ defaultIntegrations: [{ name: 'T', teardown }] }),
    );
    const second = api.initClient(
      { dsn: BROWSER_DSN, transport: recordingTransport() },
      platform(),
    );
    expect(api.getClient()).toBe(second);
    expect(second).not.toBe(first);
    expect(teardown).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[beacon] init() was called again: the previous client is replaced',
    );
  });
});
