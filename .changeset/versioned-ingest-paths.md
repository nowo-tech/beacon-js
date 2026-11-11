---
'@nowo-tech/beacon-core': minor
'@nowo-tech/beacon-browser': minor
'@nowo-tech/beacon-node': minor
'@nowo-tech/beacon-express': minor
---

Envelopes go to Beacon's versioned ingest path `/api/ingest/v1/{projectId}/envelope/` (Beacon 1.147, D-20261110-04)
and still work with any older Beacon. New `ingestPaths` option (`<beacon-reporter ingest-paths="…">`):

- `'auto'` (default): the versioned path unless the server is known to serve the alias only. On `404` or `405` the
  same envelope is sent once to the unversioned alias `/api/{projectId}/envelope/`, which Beacon keeps as a permanent
  alias. The answer is remembered per DSN for the life of the page or process (a bounded module-level cache of 32
  entries, `resetIngestPaths()` clears it), newest answer wins, and only from proof: a `2xx` or a Beacon
  `400`/`401`/`403`/`413`/`415`/`422`. `408`, `429`, `5xx`, network failures and timeouts teach nothing and are never
  re-sent by this logic. A server known as versioned that answers `404`/`405` is forgotten and the envelope re-sent
  once to the alias (self-heal). Same rules as beacon-php and BeaconBundle.
- Browser: an opaque failure (an old Beacon's `404` has no CORS headers) is re-sent to the alias only while nothing is
  known about the server, at most once per DSN, and never after the SDK's own timeout.
  Unload requests (`sendBeacon`) use the alias until the path is known, because they cannot report a status.
- `'versioned'`: always the versioned path (Beacon ≥ 1.147).
- `'legacy'`: always the unversioned alias.

Security: the fetch transport never follows redirects (`redirect: 'manual'`); a `3xx` or an opaque redirect is a
failed send. Before, Node's `fetch` followed a 307/308 and replayed `X-Beacon-Auth` (the DSN secret) and the body to
the target host.

`ParsedDsn.envelopeUrl()` and `otlpUrl()` now return the versioned URLs; the default parser adds
`legacyEnvelopeUrl()` / `legacyOtlpUrl()` (optional members: a custom parser without them never falls back), and
`otlpEndpoint(dsn, legacy?)` gives an OTLP/HTTP exporter base URL.

Size gates: core 11 → 11.3 kB, core + browser 14.5 → 14.8 kB, IIFE 17.5 → 17.8 kB (gzip), for the path fallback, its
cache, the route-proof rule and self-heal (audit LO-M1), the bounded opaque fallback (LO-L2) and the redirect refusal
(LO-M2). Measured after the change: core 11.21 kB, core + browser 14.73 kB, IIFE 17.73 kB, offline queue unchanged at
1.02 kB.
