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

- `beaconRequestHandler({ includeBody?, allowHeaders? })`: forks the scope for the request (breadcrumbs, user and
  tags never leak between requests) and records the method, the scrubbed URL and an **allow-list** of headers:
  `accept`, `accept-encoding`, `accept-language`, `content-length`, `content-type`, `referer` (without its query)
  and `user-agent`, plus the names in `allowHeaders`. Client-address headers (`*forwarded*`, `*client-ip*`,
  `*real-ip*`, `cf-*`, `fastly-*`, `x-vercel-*`, `true-client-ip`, …), cookies, `Authorization` and other credential
  headers are never recorded, even when listed or with `sendDefaultPii`.
- The body is recorded only with `includeBody: true`. JSON and form bodies are parsed, their keys scrubbed and their
  values credential-masked **before** any size check; a body over 10 kB becomes `"[truncated]"`, and one that
  cannot be parsed becomes `"[unparsed]"`. Raw text is never sent.
- Both handlers swallow their own failures: the app's request and error always go on unchanged.
- `beaconErrorHandler({ shouldHandleError? })`: captures errors without a status or with a status of 500 or more
  (mechanism `express`, `handled: false`), adds the route (`request.route`, tag `route`), stores the event id in
  `res.locals.beaconEventId`, and calls `next(err)`. Async handler rejections reach it natively in Express 5.
