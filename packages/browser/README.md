# @nowo-tech/beacon-browser

Browser SDK for [Symfony Beacon](https://github.com/nowo-tech/beacon-js): global error handlers, HTTP, DOM and
navigation breadcrumbs, and the `<beacon-reporter>` web component. The envelopes are Sentry-compatible.

```sh
npm install @nowo-tech/beacon-browser
```

```ts
import * as Beacon from '@nowo-tech/beacon-browser';

Beacon.init({ dsn: 'https://bk_xxx@beacon.example/<project-uuid>', release: 'shop@1.4.2' });
Beacon.captureException(new Error('boom'));
```

Or without a bundler, with the build Beacon serves (integrity from its `manifest.json`):

```html
<script
  src="https://beacon.example/sdk/beacon-browser/0.1.0/beacon.min.js"
  integrity="sha384-…"
  crossorigin="anonymous"
></script>
<beacon-reporter
  dsn="https://bk_xxx@beacon.example/<project-uuid>"
  release="shop@1.4.2"
></beacon-reporter>
```

- Only browser keys (`bk_…`) are accepted; a DSN with a secret is refused and nothing is sent.
- The default request is a CORS simple request (`text/plain`, the key in the envelope header, no custom header, no
  cookies), and `sendBeacon` delivers pending data when the page is hidden.
- The user's IP is never sent. See [PRIVACY](../../docs/PRIVACY.md) for the field list and the CSP note.
- `@nowo-tech/beacon-browser/element` registers `<beacon-reporter>`; `@nowo-tech/beacon-browser/offline` provides the
  IndexedDB queue (`init({ offline: indexedDbQueue() })`).

Full documentation: [docs/USAGE.md](../../docs/USAGE.md) and [docs/CONFIGURATION.md](../../docs/CONFIGURATION.md).
