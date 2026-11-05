// Child process: init, then throw an uncaught exception. Beacon must flush, then exit 1.
import * as Beacon from '@nowo-tech/beacon-node';

Beacon.init({
  dsn: process.env.BEACON_DSN,
  shutdownTimeoutMs: Number(process.env.SHUTDOWN_MS ?? 2000),
  release: 'e2e@1.0.0',
});
setTimeout(() => {
  throw new Error('uncaught in child');
}, 10);
