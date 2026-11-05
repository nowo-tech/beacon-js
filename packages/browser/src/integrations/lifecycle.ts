import type { Client, Integration } from '@nowo-tech/beacon-core';

/** Flushes with `sendBeacon` when the page is hidden or unloads, and drains the queue when back online. */
export function lifecycleIntegration(): Integration {
  let remove: (() => void) | undefined;
  return {
    name: 'Lifecycle',
    setup(client: Client) {
      const onHide = (): void => {
        if (document.visibilityState === 'hidden') void client.flush(1000, true);
      };
      const onPageHide = (): void => void client.flush(1000, true);
      const onOnline = (): void => void client.drainQueue(false, true);
      document.addEventListener('visibilitychange', onHide);
      addEventListener('pagehide', onPageHide);
      addEventListener('online', onOnline);
      remove = () => {
        document.removeEventListener('visibilitychange', onHide);
        removeEventListener('pagehide', onPageHide);
        removeEventListener('online', onOnline);
      };
    },
    teardown() {
      remove?.();
    },
  };
}
