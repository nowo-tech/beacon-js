import { close, getClient, getCurrentScope } from '@nowo-tech/beacon-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BeaconReporter, defineBeaconReporter, resetBeaconReporterOwner } from '../src/element.js';
import '../src/element-define.js';
import { DSN, stubFetch, tick } from './helpers.js';

function mount(attributes: Record<string, string> = { dsn: DSN }): BeaconReporter {
  const element = document.createElement('beacon-reporter') as BeaconReporter;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}

beforeEach(() => {
  resetBeaconReporterOwner();
  getCurrentScope().setUser(null);
});
afterEach(async () => {
  document.body.innerHTML = '';
  await close(100);
  vi.unstubAllGlobals();
});

describe('<beacon-reporter>', () => {
  it('is defined once', () => {
    expect(customElements.get('beacon-reporter')).toBe(BeaconReporter);
    const registry = {
      get: vi.fn(() => undefined),
      define: vi.fn(),
    } as unknown as CustomElementRegistry;
    defineBeaconReporter(registry);
    expect(registry.define).toHaveBeenCalledWith('beacon-reporter', BeaconReporter);
    defineBeaconReporter();
  });

  it('initialises from attributes, renders an empty hidden shadow root and fires events', async () => {
    const { sent } = stubFetch();
    const ready = vi.fn();
    document.addEventListener('beacon:ready', ready);
    const element = mount({
      dsn: DSN,
      release: 'shop@1',
      dist: 'web',
      environment: 'staging',
      'sample-rate': '1',
      'user-id': 'u1',
      'ignore-errors': 'Foo; ;Bar',
      debug: '',
    });
    expect(ready).toHaveBeenCalled();
    expect(element.shadowRoot!.childNodes).toHaveLength(0);
    expect(getComputedStyle(element).display).toBe('none');
    const client = getClient()!;
    expect(client.options).toMatchObject({
      release: 'shop@1',
      dist: 'web',
      environment: 'staging',
      sampleRate: 1,
      ignoreErrors: ['Foo', 'Bar'],
      debug: true,
    });
    expect(getCurrentScope().user).toEqual({ id: 'u1' });
    const captured = new Promise<CustomEvent>((resolve) =>
      element.addEventListener('beacon:captured', (e) => resolve(e as CustomEvent), { once: true }),
    );
    const id = client.captureMessage('hello', getCurrentScope());
    expect((await captured).detail).toEqual({ eventId: id });
    expect(sent).toHaveLength(1);
    document.removeEventListener('beacon:ready', ready);
  });

  it('fires beacon:dropped and beacon:error', async () => {
    stubFetch(403);
    const element = mount({ dsn: DSN, 'sample-rate': 'nope' });
    const outcomes: string[] = [];
    element.addEventListener('beacon:error', (e) =>
      outcomes.push(`error:${(e as CustomEvent).detail.status}`),
    );
    element.addEventListener('beacon:dropped', (e) =>
      outcomes.push(`dropped:${(e as CustomEvent).detail.reason}`),
    );
    const client = getClient()!;
    expect(client.options.sampleRate).toBeUndefined();
    client.captureMessage('a', getCurrentScope());
    await client.flush(1000);
    client.captureMessage('b', getCurrentScope());
    client.discard('sample_rate');
    expect(outcomes).toEqual(['error:403', 'dropped:sample_rate']);
  });

  it('applies attribute changes live', async () => {
    stubFetch();
    const element = mount({ dsn: DSN, release: 'r1' });
    const first = getClient()!;
    element.setAttribute('release', 'r2');
    element.setAttribute('environment', 'prod');
    expect(first.options).toMatchObject({ release: 'r2', environment: 'prod' });
    element.removeAttribute('release');
    expect(first.options.release).toBeUndefined();
    element.setAttribute('user-id', 'u2');
    expect(getCurrentScope().user).toEqual({ id: 'u2' });
    element.removeAttribute('user-id');
    expect(getCurrentScope().user).toBeUndefined();
    element.setAttribute('dist', 'ignored-live');
    element.setAttribute('release', 'r2');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    element.setAttribute(
      'dsn',
      DSN.replace('bk_test_0000000000000000', 'bk_test_1111111111111111'),
    );
    expect(getClient()).not.toBe(first);
    element.setAttribute('disabled', '');
    await tick();
    expect(getClient()).toBeUndefined();
    element.setAttribute('dsn', DSN);
    expect(getClient()).toBeUndefined();
    element.removeAttribute('disabled');
    expect(getClient()).toBeDefined();
    element.setAttribute('disabled', '');
    element.setAttribute('disabled', 'again');
    await tick();
  });

  it('starts disabled, warns without a dsn, and keeps a second element inert', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch();
    const disabled = mount({ dsn: DSN, disabled: '' });
    expect(getClient()).toBeUndefined();
    disabled.remove();
    resetBeaconReporterOwner();
    mount({});
    expect(warn).toHaveBeenCalledWith('[beacon] <beacon-reporter> needs a dsn attribute');
    resetBeaconReporterOwner();
    const owner = mount({ dsn: DSN });
    const second = mount({ dsn: DSN, release: 'x' });
    expect(warn).toHaveBeenCalledWith(
      '[beacon] a <beacon-reporter> already owns the client; this one stays inert',
    );
    second.setAttribute('release', 'y');
    expect(getClient()!.options.release).toBeUndefined();
    const flush = vi.spyOn(getClient()!, 'flush');
    second.remove();
    expect(flush).not.toHaveBeenCalled();
    owner.remove();
    expect(flush).toHaveBeenCalled();
    document.body.append(owner);
    owner.remove();
    owner.setAttribute('release', 'detached');
  });

  it('falls back to a nonce <style> without constructable stylesheets', () => {
    stubFetch();
    const replaceSync = Object.getOwnPropertyDescriptor(CSSStyleSheet.prototype, 'replaceSync')!;
    Object.defineProperty(CSSStyleSheet.prototype, 'replaceSync', {
      value: undefined,
      configurable: true,
    });
    try {
      const element = mount({ dsn: DSN, nonce: 'abc123' });
      const style = element.shadowRoot!.querySelector('style')!;
      expect(style.nonce).toBe('abc123');
      expect(style.textContent).toBe(':host{display:none}');
      resetBeaconReporterOwner();
      expect(mount({ dsn: DSN }).shadowRoot!.querySelector('style')!.nonce).toBe('');
    } finally {
      Object.defineProperty(CSSStyleSheet.prototype, 'replaceSync', replaceSync);
    }
  });
});
