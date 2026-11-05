# @nowo-tech/beacon-express

Beacon middleware for Express 4.18+ and 5. `express` is a required peer dependency.

```sh
pnpm add @nowo-tech/beacon-node @nowo-tech/beacon-express
```

```ts
import express from 'express';
import * as Beacon from '@nowo-tech/beacon-node';
import { beaconErrorHandler, beaconRequestHandler } from '@nowo-tech/beacon-express';

Beacon.init({ dsn: process.env.BEACON_DSN!, release: 'api@1.4.2' });

const app = express();
app.use(beaconRequestHandler()); // first: one isolated scope per request
// … routes …
app.use(beaconErrorHandler()); // after the routes: captures, then calls next(err)
```

- `beaconRequestHandler({ includeBody? })`: forks the scope for the request (breadcrumbs, user and tags never leak
  between requests) and records the method, the scrubbed URL and the headers. The body is recorded only with
  `includeBody: true` (scrubbed, at most 10 kB). Cookie and `Authorization` headers are only kept with
  `sendDefaultPii: true` (and are still redacted by the scrubber); IP headers are never kept.
- `beaconErrorHandler({ shouldHandleError? })`: captures errors without a status or with a status of 500 or more
  (mechanism `express`, `handled: false`), adds the route (`request.route`, tag `route`), stores the event id in
  `res.locals.beaconEventId`, and calls `next(err)`. Async handler rejections reach it natively in Express 5.
