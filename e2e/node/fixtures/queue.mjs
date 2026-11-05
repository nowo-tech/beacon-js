// Child process: file queue. Phase "fail" captures while Beacon answers 503; phase "flush" restarts and drains.
import * as Beacon from '@nowo-tech/beacon-node';

Beacon.init({ dsn: process.env.BEACON_DSN, queue: { type: 'file', dir: process.env.QUEUE_DIR } });
if (process.env.PHASE === 'fail') Beacon.captureMessage('queued while offline');
await new Promise((resolve) => setTimeout(resolve, 300));
await Beacon.close(2000);
