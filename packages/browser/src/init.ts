import {
  dedupeIntegration,
  envelopeDsnAuth,
  initClient,
  makeMemoryQueue,
  normalizeUrlFilename,
  SDK_VERSION,
  type Client,
  type ClientOptions,
  type EnvelopeQueue,
  type Integration,
  type PlatformConfig,
} from '@nowo-tech/beacon-core';
import { breadcrumbsIntegration, type BreadcrumbsOptions } from './integrations/breadcrumbs.js';
import { browserContextIntegration } from './integrations/browser-context.js';
import { globalHandlersIntegration } from './integrations/global-handlers.js';
import { httpErrorsIntegration, type StatusRange } from './integrations/http-errors.js';
import { lifecycleIntegration } from './integrations/lifecycle.js';
import { resourceErrorsIntegration } from './integrations/resource-errors.js';
import { BROWSER_QUEUE_LIMITS } from './offline.js';
import { makeBrowserTransport } from './transport.js';

export const BROWSER_SDK_NAME = 'nowo.javascript.browser';

export interface BrowserOptions extends ClientOptions {
  /**
   * Keep envelopes that could not be sent: `true` keeps them in memory for the page's life; pass
   * `indexedDbQueue()` from `@nowo-tech/beacon-browser/offline` to persist them across reloads.
   */
  offline?: boolean | EnvelopeQueue;
  /** `<img>`/`<script>`/… load failures: a breadcrumb (default), an event, or off. */
  resourceErrors?: 'breadcrumb' | 'event' | false;
  /** HTTP statuses that create an event (default `[[500, 599]]`). */
  failedRequestStatusCodes?: StatusRange[];
  breadcrumbs?: BreadcrumbsOptions;
}

/** The default integrations, in order (contract §7.2). */
export function defaultBrowserIntegrations(options: BrowserOptions = { dsn: '' }): Integration[] {
  const integrations: Integration[] = [globalHandlersIntegration()];
  if (options.resourceErrors !== false) {
    integrations.push(
      resourceErrorsIntegration({
        mode: options.resourceErrors === 'event' ? 'event' : 'breadcrumb',
      }),
    );
  }
  integrations.push(
    httpErrorsIntegration(
      options.failedRequestStatusCodes
        ? { failedRequestStatusCodes: options.failedRequestStatusCodes }
        : {},
    ),
    breadcrumbsIntegration(options.breadcrumbs),
    dedupeIntegration(),
    browserContextIntegration(),
    lifecycleIntegration(),
  );
  return integrations;
}

/** The browser platform for core's client (contract §2–§6 browser defaults). */
export function browserPlatform(options: BrowserOptions): PlatformConfig {
  const fetchImpl = globalThis.fetch.bind(globalThis);
  const { offline } = options;
  return {
    platform: 'javascript',
    sdkName: BROWSER_SDK_NAME,
    sdkVersion: SDK_VERSION,
    defaultIntegrations: defaultBrowserIntegrations(options),
    defaultAuth: envelopeDsnAuth,
    makeTransport: (clientOptions) =>
      makeBrowserTransport({
        fetch: fetchImpl,
        ...(clientOptions.compression === 'auto' ? { compression: 'auto' } : {}),
      }),
    validateDsn: (dsn) =>
      dsn.kind === 'browser'
        ? undefined
        : 'the browser SDK accepts browser keys (bk_…) only, never a server secret',
    onConfigError: 'warn',
    maxEnvelopeBytes: 200_000,
    lowerOnly: true,
    throttle: { perMinute: 30, burst: 5, refillPerSecond: 0.5 },
    identicalWindowMs: 60_000,
    maxEventsPerSession: 100,
    inFlightCap: 10,
    defaultQueue: () =>
      offline === true ? makeMemoryQueue(BROWSER_QUEUE_LIMITS) : offline || undefined,
    isOnline: () => navigator.onLine,
    normalizeFilename: normalizeUrlFilename,
    defaultIgnoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
    ],
  };
}

/** Initialises the browser SDK. A second call warns and replaces the client (HMR). */
export function init(options: BrowserOptions): Client {
  return initClient(options, browserPlatform(options));
}
