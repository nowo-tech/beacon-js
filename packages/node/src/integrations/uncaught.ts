import { getCurrentScope, type Client, type Integration } from '@nowo-tech/beacon-core';
import { nodeProcess, type ProcessLike } from '../process.js';

export interface UncaughtOptions {
  /** Default true: capture, flush, then exit with code 1 as Node would. */
  exitOnUncaught?: boolean;
  /** Flush timeout before exiting (default 2000 ms). */
  shutdownTimeoutMs?: number;
  process?: ProcessLike;
}

/**
 * `process.on('uncaughtException')` (contract §8.1): captures with `level: fatal` and `handled: false`, flushes, then
 * exits with code 1. With `exitOnUncaught: false` it only captures, and only when another listener keeps the process
 * alive; otherwise it still exits, because it must never keep alive a process Node would have killed.
 */
export function onUncaughtExceptionIntegration(options: UncaughtOptions = {}): Integration {
  const proc = options.process ?? nodeProcess;
  let handler: ((error: unknown) => void) | undefined;
  return {
    name: 'OnUncaughtException',
    setup(client: Client) {
      let exiting = false;
      handler = (error: unknown) => {
        if (exiting) {
          proc.exit(1);
          return;
        }
        const others = proc.listenerCount('uncaughtException') > 1;
        const exit = options.exitOnUncaught !== false || !others;
        client.captureException(
          error,
          getCurrentScope(),
          { level: 'fatal' },
          {
            mechanism: { type: 'onuncaughtexception', handled: false },
            logger: 'onUncaughtException',
          },
        );
        if (!exit) return;
        exiting = true;
        void client.flush(options.shutdownTimeoutMs ?? 2000).then(() => proc.exit(1));
      };
      proc.on('uncaughtException', handler);
    },
    teardown() {
      if (handler) proc.removeListener('uncaughtException', handler);
      handler = undefined;
    },
  };
}
