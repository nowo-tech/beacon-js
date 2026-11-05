import { Client, type ClientOptions, type PlatformConfig } from './client.js';
import { Scope } from './scope.js';
import type { Breadcrumb, CaptureContext, Level, User } from './types.js';

/** How the current scope is found. Node plugs in `AsyncLocalStorage` (request isolation). */
export interface AsyncContextStrategy {
  getScope(): Scope | undefined;
  withScope<T>(scope: Scope, callback: () => T): T;
}

interface Carrier {
  client?: Client | undefined;
  stack: Scope[];
  strategy?: AsyncContextStrategy | undefined;
  lastEventId?: string | undefined;
}

const KEY = '__nowoBeacon__';

/** Global state lives on `globalThis`, so that the ESM and CJS builds share one client. */
function carrier(): Carrier {
  const global = globalThis as unknown as Record<string, Carrier | undefined>;
  return (global[KEY] ??= { stack: [new Scope()] });
}

export function getClient(): Client | undefined {
  return carrier().client;
}

export function setAsyncContextStrategy(strategy: AsyncContextStrategy | undefined): void {
  carrier().strategy = strategy;
}

export function getCurrentScope(): Scope {
  const state = carrier();
  return state.strategy?.getScope() ?? state.stack[state.stack.length - 1]!;
}

/** Creates the global client. A second call logs a warning and replaces the client (HMR). */
export function initClient(options: ClientOptions, platform: PlatformConfig): Client {
  const state = carrier();
  const previous = state.client;
  if (previous) {
    console.warn('[beacon] init() was called again: the previous client is replaced');
    previous.teardown();
  }
  // Built before the previous client is closed, so that a configuration error keeps the old client working.
  const client = new Client(options, platform);
  if (previous) void previous.close(0);
  state.client = client;
  if (options.initialScope) getCurrentScope().applyContext(options.initialScope);
  return client.setup();
}

/** Captures an error. Returns the event id (empty when Beacon is not initialised). */
export function captureException(error: unknown, context?: CaptureContext): string {
  const state = carrier();
  const id = state.client?.captureException(error, getCurrentScope(), context);
  if (id) state.lastEventId = id;
  return id ?? '';
}

export function captureMessage(
  message: string,
  level: Level = 'info',
  context?: CaptureContext,
): string {
  const state = carrier();
  const id = state.client?.captureMessage(message, getCurrentScope(), level, context);
  if (id) state.lastEventId = id;
  return id ?? '';
}

/** `Error` (or any non-string) → exception, string → message. */
export function capture(errorOrMessage: unknown, context?: CaptureContext): string {
  return typeof errorOrMessage === 'string'
    ? captureMessage(errorOrMessage, context?.level ?? 'info', context)
    : captureException(errorOrMessage, context);
}

export function addBreadcrumb(crumb: Breadcrumb, hint?: Record<string, unknown>): void {
  getClient()?.addBreadcrumb(crumb, getCurrentScope(), hint);
}

export function setUser(user: User | null): void {
  getCurrentScope().setUser(user);
}

export function setTag(key: string, value: string): void {
  getCurrentScope().setTag(key, value);
}

export function setTags(tags: Record<string, string>): void {
  getCurrentScope().setTags(tags);
}

export function setContext(name: string, context: Record<string, unknown> | null): void {
  getCurrentScope().setContext(name, context);
}

export function setExtra(key: string, value: unknown): void {
  getCurrentScope().setExtra(key, value);
}

/** Runs `callback` with a forked scope. Without an async strategy, the fork ends when the callback returns. */
export function withScope<T>(callback: (scope: Scope) => T): T {
  const state = carrier();
  const scope = getCurrentScope().clone();
  if (state.strategy) return state.strategy.withScope(scope, () => callback(scope));
  state.stack.push(scope);
  try {
    return callback(scope);
  } finally {
    state.stack.splice(state.stack.indexOf(scope), 1);
  }
}

export function lastEventId(): string | undefined {
  return carrier().lastEventId;
}

export function flush(timeoutMs = 2000): Promise<boolean> {
  return getClient()?.flush(timeoutMs) ?? Promise.resolve(true);
}

/** Closes the global client and forgets it. */
export function close(timeoutMs = 2000): Promise<boolean> {
  const state = carrier();
  const client = state.client;
  state.client = undefined;
  return client?.close(timeoutMs) ?? Promise.resolve(true);
}
