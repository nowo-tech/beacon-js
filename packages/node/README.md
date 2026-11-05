# @nowo-tech/beacon-node

Beacon SDK for Node.js ≥ 20. It re-exports the whole public API of `@nowo-tech/beacon-core`, so this is the only
package a Node app installs (plus `@nowo-tech/beacon-express` for Express).

```sh
pnpm add @nowo-tech/beacon-node
```

```ts
import * as Beacon from '@nowo-tech/beacon-node';

Beacon.init({
  dsn: process.env.BEACON_DSN!, // https://<public>:<secret>@beacon.example/<project uuid>
  release: 'api@1.4.2',
  environment: 'production',
});

Beacon.captureException(new Error('boom'), { tags: { area: 'billing' } });
await Beacon.close(2000); // on shutdown
```

## Options (in addition to the core options)

| Option                 | Default                       | Meaning                                                                                                                     |
| ---------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `appRoot`              | `process.cwd()`               | frame filenames are relative to it (`src/…`), which keeps Beacon's grouping stable                                          |
| `includeSourceContext` | `true`                        | 5 lines of source around `in_app` frames (LRU of 100 files, 1 MiB per file)                                                 |
| `exitOnUncaught`       | `true`                        | after an uncaught exception: capture (`fatal`), flush, exit with code 1                                                     |
| `shutdownTimeoutMs`    | `2000`                        | flush timeout for crashes and signals                                                                                       |
| `shutdownHandlers`     | none                          | opt-in signals (`['SIGTERM', 'SIGINT']`): flush, then re-raise the signal                                                   |
| `unhandledRejections`  | from `--unhandled-rejections` | `throw` / `strict` capture, flush and exit 1; `warn` / `none` only capture                                                  |
| `queue`                | memory (100)                  | `{ type: 'file', dir }` keeps envelopes as `0600` files (100 files / 10 MiB) and flushes them on start; `false` disables it |
| `compression`          | `'auto'`                      | gzip (level 6) for bodies over 1 kB, sent uncompressed when the ratio would exceed 50:1                                     |

The DSN must be a **server** DSN with a secret. Browser keys (`bk_…`) are refused, and so is a DSN without a secret.
The secret is sent only in `X-Beacon-Auth: Beacon beacon_key=…, beacon_secret=…`: never in the URL, the envelope,
errors or logs. `serverEnvelopeDsnAuth()` is an opt-in for proxies that strip custom headers.

## Default integrations

`RequestIsolation` (one scope per `AsyncLocalStorage` context), `Dedupe`, `Context` (runtime, os, app, device),
`ContextLines`, `OnUncaughtException`, `OnUnhandledRejection`, `Http` (breadcrumbs for `http`, `https` and `fetch` via
`diagnostics_channel`, URL scrubbed, requests to Beacon excluded), `Console` (`warn` / `error` breadcrumbs) and
`Shutdown` (`beforeExit` flush, opt-in signals).

## What is sent

Errors and messages with their stack trace (filenames relative to `appRoot`), breadcrumbs, tags, extra, the user you
set, runtime/os context and, with `@nowo-tech/beacon-express`, the scrubbed request (method, URL, route, headers). The
user IP is never sent, `server_name` only with `sendDefaultPii: true` or `serverName`, and the default scrubber
redacts credentials, cookies and sensitive keys before `beforeSend` runs.
