import {
  beaconServerAuth,
  dedupeIntegration,
  initClient,
  makeFetchTransport,
  makeMemoryQueue,
  SDK_VERSION,
  type Client,
  type ClientOptions,
  type EnvelopeQueue,
  type Integration,
  type PlatformConfig,
} from '@nowo-tech/beacon-core';
import { makeFileQueue, type FileQueueOptions } from './file-queue.js';
import { makeNodeFilenameNormalizer } from './filename.js';
import { gzipCompressor } from './gzip.js';
import { consoleIntegration } from './integrations/console.js';
import { contextLinesIntegration } from './integrations/context-lines.js';
import { contextIntegration } from './integrations/context.js';
import { httpIntegration } from './integrations/http.js';
import { requestIsolationIntegration } from './integrations/isolation.js';
import { onUnhandledRejectionIntegration, type RejectionMode } from './integrations/rejection.js';
import { shutdownIntegration } from './integrations/shutdown.js';
import { onUncaughtExceptionIntegration } from './integrations/uncaught.js';
import type { ProcessLike } from './process.js';

export interface NodeOptions extends Omit<ClientOptions, 'queue'> {
  /** Filenames are made relative to this directory (default `process.cwd()`). */
  appRoot?: string;
  /** Source context for `in_app` frames (default true). */
  includeSourceContext?: boolean;
  /** Default true: exit with code 1 after an uncaught exception, as Node would. */
  exitOnUncaught?: boolean;
  /** Flush timeout for crashes and signals (default 2000 ms). */
  shutdownTimeoutMs?: number;
  /** Opt-in, e.g. `['SIGTERM', 'SIGINT']`. */
  shutdownHandlers?: string[];
  /** Overrides the `--unhandled-rejections` mode. */
  unhandledRejections?: RejectionMode;
  /** Memory queue by default (100 envelopes); `{ type: 'file', dir }` persists envelopes; `false` disables it. */
  queue?: EnvelopeQueue | FileQueueOptions | false;
  /** For tests: the process the handlers attach to. */
  process?: ProcessLike;
}

export const NODE_SDK_NAME = 'nowo.javascript.node';

/** The default Node integrations for the given options. */
export function defaultNodeIntegrations(options: NodeOptions = { dsn: '' }): Integration[] {
  const shared = {
    ...(options.shutdownTimeoutMs !== undefined
      ? { shutdownTimeoutMs: options.shutdownTimeoutMs }
      : {}),
    ...(options.process ? { process: options.process } : {}),
  };
  const integrations: Integration[] = [
    requestIsolationIntegration(),
    dedupeIntegration(),
    contextIntegration(
      options.sendDefaultPii !== undefined ? { sendDefaultPii: options.sendDefaultPii } : {},
    ),
  ];
  if (options.includeSourceContext !== false) integrations.push(contextLinesIntegration());
  integrations.push(
    onUncaughtExceptionIntegration({
      ...shared,
      ...(options.exitOnUncaught !== undefined ? { exitOnUncaught: options.exitOnUncaught } : {}),
    }),
    onUnhandledRejectionIntegration({
      ...shared,
      ...(options.unhandledRejections ? { mode: options.unhandledRejections } : {}),
    }),
    httpIntegration(),
    consoleIntegration(),
    shutdownIntegration({
      ...shared,
      ...(options.shutdownHandlers ? { shutdownHandlers: options.shutdownHandlers } : {}),
    }),
  );
  return integrations;
}

/** The Node `PlatformConfig` for core (contract §2.1, §3.1 rule 8, §4.4–§4.6, §6). */
export function nodePlatform(options: NodeOptions = { dsn: '' }): PlatformConfig {
  return {
    platform: 'node',
    sdkName: NODE_SDK_NAME,
    sdkVersion: SDK_VERSION,
    defaultIntegrations: defaultNodeIntegrations(options),
    defaultAuth: beaconServerAuth,
    makeTransport: (clientOptions) =>
      makeFetchTransport({
        contentType: 'application/x-beacon-envelope',
        timeoutMs: 15_000,
        compressMinBytes: 1024,
        ...(clientOptions.compression === 'auto' ? { compress: gzipCompressor } : {}),
      }),
    validateDsn: (dsn) =>
      dsn.kind === 'browser'
        ? 'a browser key (bk_) cannot be used from Node; use a server DSN with a secret'
        : undefined,
    onConfigError: 'throw',
    maxEnvelopeBytes: 1024 * 1024,
    lowerOnly: false,
    throttle: { perMinute: 100, burst: 20, refillPerSecond: 1.6 },
    identicalWindowMs: 10_000,
    inFlightCap: 30,
    defaultQueue: () =>
      makeMemoryQueue({
        maxEnvelopes: 100,
        maxBytes: 10 * 1024 * 1024,
        ttlMs: 7 * 24 * 3600 * 1000,
      }),
    normalizeFilename: makeNodeFilenameNormalizer(options.appRoot ?? process.cwd()),
  };
}

/**
 * Initialises Beacon for Node. Throws `BeaconConfigError` on an invalid DSN, a server DSN without a secret, or a
 * browser (`bk_`) key. The error message never contains the DSN or the secret.
 */
export function init(options: NodeOptions): Client {
  const { queue, ...rest } = options;
  const clientOptions: ClientOptions = rest;
  if (queue !== undefined) {
    clientOptions.queue = queue !== false && 'type' in queue ? makeFileQueue(queue) : queue;
  }
  return initClient(clientOptions, nodePlatform(options));
}
