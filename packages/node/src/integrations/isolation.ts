import { AsyncLocalStorage } from 'node:async_hooks';
import { setAsyncContextStrategy, type Integration, type Scope } from '@nowo-tech/beacon-core';

/**
 * One scope per async context (`AsyncLocalStorage`), so that the breadcrumbs, user and tags of one request never
 * leak into another (contract §8.1). `withScope` forks the current scope for the callback and its continuations.
 */
export function requestIsolationIntegration(): Integration {
  const storage = new AsyncLocalStorage<Scope>();
  return {
    name: 'RequestIsolation',
    setup() {
      setAsyncContextStrategy({
        getScope: () => storage.getStore(),
        withScope: (scope, callback) => storage.run(scope, callback),
      });
    },
    teardown() {
      setAsyncContextStrategy(undefined);
    },
  };
}
