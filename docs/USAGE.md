# Usage

## Browser

```ts
import * as Beacon from '@nowo-tech/beacon-browser';

Beacon.init({
  dsn: 'https://bk_xxx@beacon.example/<project-uuid>',
  release: 'shop@1.4.2',
  environment: 'production',
});

Beacon.captureException(error, { tags: { area: 'checkout' }, level: 'error' }); // returns the event id
Beacon.captureMessage('Payment provider slow', 'warning');
Beacon.capture(errorOrMessage); // Error → exception, string → message
Beacon.addBreadcrumb({ category: 'cart', message: 'item added' });
Beacon.setUser({ id: '42' }); // never an IP: it is always stripped
Beacon.setTag('plan', 'pro');
Beacon.setContext('cart', { items: 3 });
Beacon.withScope((scope) => {
  scope.setTag('job', 'sync');
  Beacon.captureMessage('scoped');
});
await Beacon.flush(2000);
await Beacon.close(2000);
Beacon.lastEventId();
```

Default integrations: `GlobalHandlers` (`error`, `unhandledrejection`), `ResourceErrors` (failed `<script>`,
`<link>`, `<video>`, `<audio>` loads as breadcrumbs; `<img>` off), `HttpErrors` (`fetch` and XHR breadcrumbs, events
for network failures and 5xx; never for Beacon itself), `Breadcrumbs` (console warn/error, clicks and key presses as
selectors only, navigation), `Dedupe`, `BrowserContext`, and the page lifecycle (flush with `sendBeacon` when the
page is hidden, queue flush when back online). `close()` restores every wrapped function.

### `<beacon-reporter>`

```html
<script src="…/beacon.min.js" integrity="sha384-…" crossorigin="anonymous"></script>
<beacon-reporter
  dsn="https://bk_xxx@beacon.example/<uuid>"
  release="shop@1.4.2"
  environment="production"
></beacon-reporter>
```

Attributes: `dsn` (required), `release`, `dist`, `environment`, `sample-rate`, `debug`, `disabled`, `user-id`,
`nonce`, `ignore-errors` (`;`-separated), `ingest-paths` (`auto` | `versioned` | `legacy`, see CONFIGURATION). `release`, `environment`, `user-id` and `disabled` apply live; a new `dsn`
re-initialises the client. Events (bubbling, composed): `beacon:ready`, `beacon:captured` (`{eventId}`),
`beacon:dropped` (`{reason}`), `beacon:error` (`{status}`). With a bundler, `import '@nowo-tech/beacon-browser/element'`
registers it.

### Offline queue

```ts
import { indexedDbQueue } from '@nowo-tech/beacon-browser/offline';

Beacon.init({ dsn, offline: indexedDbQueue() }); // persists across reloads (30 envelopes, 1 MiB, 7 days)
Beacon.init({ dsn, offline: true }); // in memory, for the page's life
```

## Node

```ts
import * as Beacon from '@nowo-tech/beacon-node';

Beacon.init({ dsn: process.env.BEACON_DSN, release: 'api@2.0.0', shutdownHandlers: ['SIGTERM'] });
```

Defaults: uncaught exceptions are captured (`fatal`), flushed, and the process exits with code 1 as Node would;
unhandled rejections follow `--unhandled-rejections`; `http`, `https` and `fetch` breadcrumbs via
`diagnostics_channel`; console breadcrumbs; runtime/os/app context; source context for in-app frames;
`AsyncLocalStorage` request isolation; opt-in gzip for bodies over 1 kB (`compression: 'auto'`, Beacon ≥ 1.143); a memory queue (or `queue: { type: 'file', dir }`).

## Express

```ts
import { beaconErrorHandler, beaconRequestHandler } from '@nowo-tech/beacon-express';

app.use(beaconRequestHandler()); // first: isolated scope + scrubbed request context (no body by default)
// routes
app.use(beaconErrorHandler({ shouldHandleError: (err) => (err.status ?? 500) >= 500 })); // after the routes
```
