# beacon-js

TypeScript SDK for **Symfony Beacon**: error reporting from browsers and Node.js. The envelopes stay wire-compatible
with Sentry's: they are valid Sentry envelopes, restricted to a strict subset (one event per envelope, single-line
payloads, exact `length`).

| Package                                         | What it is                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`@nowo-tech/beacon-core`](packages/core)       | event model, envelope encoder, transport, scopes, scrubbing, truncation (zero runtime deps)      |
| [`@nowo-tech/beacon-browser`](packages/browser) | browser SDK, the `<beacon-reporter>` web component, ESM and IIFE (`beacon.min.js`) builds        |
| [`@nowo-tech/beacon-node`](packages/node)       | Node.js ≥ 20 SDK: process handlers, HTTP breadcrumbs, request isolation, opt-in gzip, file queue |
| [`@nowo-tech/beacon-express`](packages/express) | Express 4 and 5 middleware                                                                       |

Status: **0.1.0, pre-release, not published to npm yet.** The packages are versioned together.

## Quick start

Browser (a public browser key `bk_…`; a DSN with a secret is refused):

```ts
import * as Beacon from '@nowo-tech/beacon-browser';

Beacon.init({ dsn: 'https://bk_xxx@beacon.example/<project-uuid>', release: 'shop@1.4.2' });
```

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

Node + Express (a server key with its secret, sent only in the `X-Beacon-Auth` header):

```ts
import * as Beacon from '@nowo-tech/beacon-node';
import { beaconErrorHandler, beaconRequestHandler } from '@nowo-tech/beacon-express';

Beacon.init({ dsn: process.env.BEACON_DSN, release: 'api@2.0.0' });
app.use(beaconRequestHandler());
// … routes …
app.use(beaconErrorHandler());
```

More: [USAGE](docs/USAGE.md) · [CONFIGURATION](docs/CONFIGURATION.md) · [PRIVACY](docs/PRIVACY.md) ·
[FRAMEWORKS](docs/FRAMEWORKS.md) · [SOURCEMAPS](docs/SOURCEMAPS.md) · [CONTRIBUTING](CONTRIBUTING.md) ·
[SECURITY](SECURITY.md)

## Repository layout

```
packages/           the published packages
e2e/mock-beacon     mock Beacon server (Beacon's ingest rules incl. spec 172), used by the e2e and the golden set
e2e/node            Node e2e (Express 5 app against the mock, node:test, Node 20/22/24)
e2e/browser         Playwright e2e (IIFE + <beacon-reporter>, Chromium, Firefox, WebKit)
fixtures/envelopes  golden envelope set (inputs + generated files), attached to every release
tooling/            build (esbuild + tsc + API Extractor), shared Vitest config, pack check
```

## License

MIT, see [LICENSE](LICENSE).
