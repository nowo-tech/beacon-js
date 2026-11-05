# Configuration

| Option                                  | Default                                                 | Notes                                                                      |
| --------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `dsn`                                   | required                                                | browser: `https://bk_…@host/<uuid>`; Node: `https://<pk>:<sk>@host/<uuid>` |
| `release`, `dist`, `environment`        | —, —, `production`                                      |                                                                            |
| `sampleRate`                            | `1`                                                     | applied before `beforeSend`                                                |
| `maxBreadcrumbs`                        | `50`                                                    | clamped to 100                                                             |
| `sendDefaultPii`                        | `false`                                                 | never sends the IP, whatever its value                                     |
| `integrations`                          | defaults                                                | an array, or `(defaults) => array`                                         |
| `beforeSend(event, hint)`               | —                                                       | after the scrubber; may return `null` or a promise                         |
| `beforeBreadcrumb(crumb, hint)`         | —                                                       |                                                                            |
| `ignoreErrors`, `denyUrls`, `allowUrls` | browser: ResizeObserver noise                           | strings or RegExps                                                         |
| `inAppInclude`, `inAppExclude`          | —                                                       | override `in_app`                                                          |
| `normalizeFilename(frame)`              | origin, query, hash and content hash stripped           | Node: relative to `appRoot` / cwd                                          |
| `scrubber`                              | default scrubber                                        | `false` disables it (logs a warning in debug mode)                         |
| `authProvider`, `dsnParser`             | browser `envelopeDsnAuth`, Node `beaconServerAuth`      | also `headerBrowserKeyAuth`, `serverEnvelopeDsnAuth`                       |
| `transport`                             | fetch transport                                         | custom `Transport`                                                         |
| `maxEnvelopeBytes`                      | browser 200 000, Node 1 MiB                             | the browser can only lower it                                              |
| `compression`                           | `'auto'`                                                | browser: gzip over 32 kB (never on unload); Node: over 1 kB; `false` off   |
| `throttle`                              | browser 30/min, burst 5, 0.5/s; Node 100/min, 20, 1.6/s | the browser can only lower it                                              |
| `maxEventsPerSession`                   | browser 100                                             |                                                                            |
| `sendClientReports`                     | `true`                                                  | `client_report` in its own envelope, at most once per 60 s and on unload   |
| `queue` / `offline`                     | Node memory; browser off                                | see USAGE                                                                  |
| `debug`, `enabled`, `initialScope`      | `false`, `true`, —                                      |                                                                            |
| `onOutcome(outcome)`                    | —                                                       | `captured` / `dropped` / `error` (used by `<beacon-reporter>`)             |

Node only: `appRoot`, `includeSourceContext` (`true`), `exitOnUncaught` (`true`), `shutdownTimeoutMs` (`2000`),
`shutdownHandlers` (off), `unhandledRejections`, `serverName`.

Browser only: `resourceErrors` (`'breadcrumb'` | `'event'` | `false`), `failedRequestStatusCodes` (`[[500, 599]]`),
`breadcrumbs: { console, dom, navigation }`.

## Transport behaviour

- `429`: the whole transport waits until `Retry-After` (60 s if missing; at least 1 h for `X-Beacon-Rate-Limit:
quota`). `X-Beacon-Rate-Limit` is kept in `client.lastRateLimit`.
- `503`, other `5xx`, network errors, timeouts (browser 10 s, Node 15 s): retried with exponential backoff (full
  jitter, 1 s base, 5 min max); queued when a queue exists.
- `401` / `403`: the client disables itself for 1 h. Three opaque failures in a row while online (a refused origin)
  do the same in the browser.
- `413`: dropped, and the next events use half the size cap. `400`: dropped and logged in debug mode.
