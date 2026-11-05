import { getCurrentScope, type Client, type Integration } from '@nowo-tech/beacon-core';

/** Builds an error-like value from an `ErrorEvent` without an `error` (cross-origin scripts, old engines). */
export function errorFromEvent(event: ErrorEvent): unknown {
  if (event.error !== undefined && event.error !== null) return event.error;
  const message = event.message || 'Unknown error';
  const location = event.filename
    ? `\n    at ? (${event.filename}:${event.lineno || 0}:${event.colno || 0})`
    : '';
  return { name: 'Error', message, stack: `Error: ${message}${location}` };
}

/** `window` `error` (runtime errors) and `unhandledrejection` (contract §7.2). */
export function globalHandlersIntegration(): Integration {
  let remove: (() => void) | undefined;
  return {
    name: 'GlobalHandlers',
    setup(client: Client) {
      const onError = (event: ErrorEvent): void => {
        client.captureException(errorFromEvent(event), getCurrentScope(), undefined, {
          mechanism: { type: 'onerror', handled: false },
          logger: 'window.onerror',
        });
      };
      const onRejection = (event: PromiseRejectionEvent): void => {
        client.captureException(event.reason, getCurrentScope(), undefined, {
          mechanism: { type: 'onunhandledrejection', handled: false },
          logger: 'window.onunhandledrejection',
        });
      };
      addEventListener('error', onError);
      addEventListener('unhandledrejection', onRejection);
      remove = () => {
        removeEventListener('error', onError);
        removeEventListener('unhandledrejection', onRejection);
      };
    },
    teardown() {
      remove?.();
    },
  };
}
