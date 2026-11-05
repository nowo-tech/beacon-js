import type { Client, Integration } from '@nowo-tech/beacon-core';
import { nodeProcess, type ProcessLike } from '../process.js';

export interface ShutdownOptions {
  /** Opt-in signals to flush on, then re-raise (default none, so the app's signal semantics are unchanged). */
  shutdownHandlers?: string[];
  shutdownTimeoutMs?: number;
  process?: ProcessLike;
}

/**
 * Graceful shutdown (contract §8.3): a short flush on `beforeExit`, and for the opt-in signals a flush followed by the
 * default behaviour (the listener removes itself and re-sends the signal to the process).
 */
export function shutdownIntegration(options: ShutdownOptions = {}): Integration {
  const proc = options.process ?? nodeProcess;
  const listeners: Array<[string, () => void]> = [];
  return {
    name: 'Shutdown',
    setup(client: Client) {
      let flushing = false;
      const beforeExit = (): void => {
        if (flushing) return;
        flushing = true;
        void client.flush(500).then(() => {
          flushing = false;
        });
      };
      proc.on('beforeExit', beforeExit);
      listeners.push(['beforeExit', beforeExit]);
      for (const signal of options.shutdownHandlers ?? []) {
        const handler = (): void => {
          proc.removeListener(signal, handler);
          void client
            .flush(options.shutdownTimeoutMs ?? 2000)
            .then(() => proc.kill(proc.pid, signal));
        };
        proc.on(signal, handler);
        listeners.push([signal, handler]);
      }
    },
    teardown() {
      for (const [event, listener] of listeners.splice(0)) proc.removeListener(event, listener);
    },
  };
}
