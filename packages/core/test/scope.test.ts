import { describe, expect, it } from 'vitest';
import { Scope } from '../src/scope.js';

describe('Scope', () => {
  it('stores and clones data independently', () => {
    const scope = new Scope()
      .setUser({ id: '1' })
      .setTag('a', 'b')
      .setTags({ c: 'd' })
      .setExtra('e', 1)
      .setContext('app', { v: 1 })
      .setLevel('warning')
      .setFingerprint(['f'])
      .addBreadcrumb({ message: 'one' }, 2);
    scope.request = { url: '/x' };
    const clone = scope.clone();
    clone
      .setTag('a', 'changed')
      .addBreadcrumb({ message: 'two' }, 2)
      .addBreadcrumb({ message: 'three' }, 2);
    expect(scope.tags).toEqual({ a: 'b', c: 'd' });
    expect(scope.breadcrumbs).toHaveLength(1);
    expect(clone.breadcrumbs.map((b) => b.message)).toEqual(['two', 'three']);
    expect(clone.user).toEqual({ id: '1' });
    expect(clone.fingerprint).toEqual(['f']);
    scope.setContext('app', null).setUser(null);
    expect(scope.contexts).toEqual({});
    expect(scope.user).toBeUndefined();
    expect(new Scope().clone().user).toBeUndefined();
  });

  it('applies capture contexts over the scope', () => {
    const scope = new Scope().setTag('a', '1');
    scope.applyContext(undefined);
    scope.applyContext({
      tags: { b: '2' },
      extra: { x: 1 },
      contexts: { c: { k: 1 } },
      user: { id: 'u' },
      level: 'fatal',
      fingerprint: ['g'],
    });
    expect(scope).toMatchObject({
      tags: { a: '1', b: '2' },
      extra: { x: 1 },
      contexts: { c: { k: 1 } },
      user: { id: 'u' },
      level: 'fatal',
      fingerprint: ['g'],
    });
    scope.applyContext({});
    expect(scope.level).toBe('fatal');
  });

  it('merges into events, event fields win', () => {
    const scope = new Scope()
      .setUser({ id: 's' })
      .setTag('t', 'scope')
      .setExtra('x', 1)
      .setContext('c', { a: 1 })
      .setLevel('warning')
      .setFingerprint(['f']);
    scope.request = { url: '/r' };
    scope.addBreadcrumb({ message: 'b' }, 10);
    const event = scope.applyToEvent({
      user: { id: 'e' },
      tags: { t: 'event' },
      fingerprint: ['e'],
      request: { url: '/e' },
      breadcrumbs: { values: [{ message: 'own' }] },
    });
    expect(event).toMatchObject({
      user: { id: 'e' },
      tags: { t: 'event' },
      extra: { x: 1 },
      contexts: { c: { a: 1 } },
      level: 'warning',
      fingerprint: ['e'],
      request: { url: '/e' },
    });
    expect(event.breadcrumbs!.values.map((b) => b.message)).toEqual(['b', 'own']);
    const bare = scope.applyToEvent({});
    expect(bare).toMatchObject({ user: { id: 's' }, fingerprint: ['f'], request: { url: '/r' } });
    expect(new Scope().applyToEvent({})).toEqual({});
  });
});
