// Child process: opt-in SIGTERM handler flushes a captured event before the default signal behaviour.
import * as Beacon from '@nowo-tech/beacon-node';

Beacon.init({ dsn: process.env.BEACON_DSN, shutdownHandlers: ['SIGTERM'] });
Beacon.captureMessage('before sigterm', 'warning');
setInterval(() => {}, 1000);
console.log('ready');
