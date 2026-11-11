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
| `compression`                           | `false`                                                 | uncompressed; `'auto'` (requires Beacon ≥ 1.143, see below) gzips          |
| `ingestPaths`                           | `'auto'`                                                | `'versioned'` / `'legacy'` force one ingest path (see below)               |
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

## Compression

`compression` defaults to `false`: every body is sent uncompressed. Beacon's ingest decompresses
`Content-Encoding: gzip` from **Beacon 1.143** on; older versions cannot read a gzipped envelope.

`compression: 'auto'` is an explicit opt-in that **requires Beacon ≥ 1.143**. It gzips bodies over 32 kB in the browser
(with `CompressionStream`, never while the page unloads) and over 1 kB in Node (level 6). A body whose ratio would
exceed 50:1 is still sent uncompressed, since Beacon refuses it with `413`.

## Ingest paths

Beacon 1.147 serves the ingest under versioned paths (D-20261110-04) and keeps the old ones as **permanent** aliases:

| What      | Versioned (canonical)                                                      | Unversioned alias                                   |
| --------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| Envelope  | `{origin}{prefix}/api/ingest/v1/{projectId}/envelope/`                     | `{origin}{prefix}/api/{projectId}/envelope/`        |
| OTLP/HTTP | `{origin}{prefix}/api/ingest/v1/{projectId}/otlp/v1/{traces,logs,metrics}` | `{origin}{prefix}/api/{projectId}/otlp/v1/{signal}` |

`ingestPaths` (`<beacon-reporter ingest-paths="…">`) chooses the envelope path:

- `'auto'` (default) works with every Beacon. Envelopes go to the versioned path unless the DSN's server is known to
  serve the alias only. On `404` or `405` the same envelope is sent **once** to the alias; a `404`/`405` means nothing
  was processed, so this never duplicates an envelope. What the server serves is remembered per DSN (origin, path
  prefix and project) for the life of the page or process, the newest answer replacing the older one, and only from
  proof (same rules as beacon-php and BeaconBundle):

  | Answer                                                            | Learned                                    | Re-sent to the alias |
  | ----------------------------------------------------------------- | ------------------------------------------ | -------------------- |
  | versioned `2xx`, or a Beacon `400`/`401`/`403`/`413`/`415`/`422`  | versioned                                  | no                   |
  | versioned `404`/`405`                                             | (forgotten if it was versioned: self-heal) | once                 |
  | versioned `408`/`429`/`5xx`/other, a network failure or a timeout | nothing (the next envelope probes again)   | no                   |
  | alias `2xx`, or a Beacon `400`/`401`/`403`/`413`/`415`/`422`      | alias                                      | —                    |
  | alias `404`/`405` too (unknown project)                           | versioned                                  | —                    |
  | alias `408`/`429`/`5xx`/other, or a network failure               | nothing                                    | —                    |

  A transient `503` from a proxy in front of an older Beacon therefore never pins the versioned path, and a server
  known as versioned that starts answering `404` (a downgrade) heals itself on the next envelope.

  In the browser an older Beacon answers an unknown path with a `404` that carries no CORS headers, so the fetch fails
  opaquely. A current Beacon's IP-limiter `429` and its origin-gate `401`/`403` are opaque too, so the opaque-failure
  fallback is limited: it re-sends to the alias only while nothing is known about the server, at most once per DSN
  (if the alias is opaque as well, later opaque failures are not re-sent), and never after the SDK's own timeout,
  because the first request may have been accepted. While the path is unknown, requests made as the page unloads
  (`sendBeacon`, which cannot report a status) use the alias.

- `'versioned'`: always the versioned path (Beacon ≥ 1.147); no fallback.
- `'legacy'`: always the alias.

Redirects are never followed (`redirect: 'manual'`, also when `fetchInit` asks otherwise): a `3xx`, or a browser
`opaqueredirect`, is a failed send that is not re-sent, so `X-Beacon-Auth` and the body never reach another host.

The memory is a module-level map bounded to 32 DSNs (oldest evicted). It describes the server, never a user or a
request, so it is safe in long-lived Node processes; `resetIngestPaths()` clears it (tests, or a Beacon upgraded
under a running process that should switch back to the versioned path before a restart).

`ParsedDsn.envelopeUrl()` / `otlpUrl(signal)` return the versioned URLs; the default parser also has
`legacyEnvelopeUrl()` / `legacyOtlpUrl(signal)` (optional members of `ParsedDsn`: a custom `dsnParser` without them
always uses `envelopeUrl()`). `otlpEndpoint(dsn)` gives the OTLP/HTTP exporter base URL
(`…/api/ingest/v1/{projectId}/otlp`, the exporter appends `/v1/{signal}`); `otlpEndpoint(dsn, true)` the alias for a
Beacon older than 1.147. OTLP exporters have no fallback of their own: pick the one your Beacon serves.

## Transport behaviour

- No server answer blocks the transport for more than **24 h** (a larger `Retry-After` is clamped), and no timer
  is ever armed above 2³¹−1 ms.
- `429`: the whole transport waits until `Retry-After` (60 s if missing; at least 1 h for `X-Beacon-Rate-Limit:
quota`). `X-Beacon-Rate-Limit` is kept in `client.lastRateLimit`.
- `503`, other `5xx`, network errors, timeouts (browser 10 s, Node 15 s): retried with exponential backoff (full
  jitter, 1 s base, 5 min max); queued when a queue exists.
- `401` / `403`: the client disables itself for 1 h. Three opaque failures in a row while online (a refused origin)
  do the same in the browser.
- `413`: dropped, and the next events use half the size cap. `400`: dropped and logged in debug mode.

## Queue flush and the rate limits

A queue is flushed one envelope at a time, without taking self-throttle tokens: it is bounded by the queue caps
(30 envelopes in the browser, 100 in Node), which stay below Beacon's per-IP (60/min) and per-project (120/min)
defaults. Several tabs of the same user coming back online at once can still come close to the per-IP limit; the
`429` handling then applies.
