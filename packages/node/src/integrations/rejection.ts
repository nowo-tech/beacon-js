import { getCurrentScope, type Client, type Integration } from '@nowo-tech/beacon-core';
import { nodeProcess, type ProcessLike } from '../process.js';

export type RejectionMode = 'throw' | 'strict' | 'warn' | 'none' | 'warn-with-error-code';

export interface RejectionOptions {
  /** Default: read from `--unhandled-rejections` in `execArgv` or `NODE_OPTIONS`, else `throw`. */
  mode?: RejectionMode;
  shutdownTimeoutMs?: number;
  process?: ProcessLike;
}

/** The `--unhandled-rejections` mode of this process. */
export function rejectionMode(proc: ProcessLike): RejectionMode {
  const flags = [...proc.execArgv, proc.env['NODE_OPTIONS'] ?? ''].join(' ');
  const match = /--unhandled-rejections[= ]([a-z-]+)/.exec(flags);
  return (match?.[1] as RejectionMode | undefined) ?? 'throw';
}

/**
 * `process.on('unhandledRejection')` (contract §8.1). In `throw` (Node's default) and `strict` modes it captures,
 * flushes and then crashes like Node would (the reason on stderr, exit code 1), unless the app has its own listener.
 * In `warn` / `none` it only captures; `warn-with-error-code` also sets `process.exitCode = 1`.
 */
export function onUnhandledRejectionIntegration(options: RejectionOptions = {}): Integration {
  const proc = options.process ?? nodeProcess;
  let handler: ((reason: unknown) => void) | undefined;
  return {
    name: 'OnUnhandledRejection',
    setup(client: Client) {
      const mode = options.mode ?? rejectionMode(proc);
      handler = (reason: unknown) => {
        client.captureException(
          reason,
          getCurrentScope(),
          { level: 'error' },
          {
            mechanism: { type: 'onunhandledrejection', handled: false },
            logger: 'onUnhandledRejection',
          },
        );
        if (mode === 'warn-with-error-code') proc.exitCode = 1;
        if ((mode !== 'throw' && mode !== 'strict') || proc.listenerCount('unhandledRejection') > 1)
          return;
        void client.flush(options.shutdownTimeoutMs ?? 2000).then(() => {
          console.error(reason);
          proc.exit(1);
        });
      };
      proc.on('unhandledRejection', handler);
    },
    teardown() {
      if (handler) proc.removeListener('unhandledRejection', handler);
      handler = undefined;
    },
  };
}
