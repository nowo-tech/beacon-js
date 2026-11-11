# @nowo-tech/beacon-core

## 0.2.0

### Minor Changes

- 90a4679: Envelopes go to Beacon's versioned ingest path `/api/ingest/v1/{projectId}/envelope/` (Beacon 1.147, D-20261110-04)
  and still work with any older Beacon. New `ingestPaths` option (`<beacon-reporter ingest-paths="…">`):
  
  - `'auto'` (default): the versioned path unless the server is known to serve the alias only. On `404` or `405` the
    same envelope is sent once to the unversioned alias `/api/{projectId}/envelope/`, which Beacon keeps as a permanent
    alias. The answer is remembered per DSN for the life of the page or process (a bounded module-level cache of 32
    entries, `resetIngestPaths()` clears it), newest answer wins, and only from proof: a `2xx` or a Beacon
    `400`/`401`/`403`/`413`/`415`/`422`. `408`, `429`, `5xx`, network failures and timeouts teach nothing and are never
    re-sent by this logic. A server known as versioned that answers `404`/`405` is forgotten and the envelope re-sent
    once to the alias (self-heal). Same rules as beacon-php and BeaconBundle.
  - Browser: an opaque failure (an old Beacon's `404` has no CORS headers) is re-sent to the alias only while nothing is
    known about the server, at most once per DSN every 5 minutes (audit LOD-L1: a network outage on both paths no
    longer cuts the page off an older Beacon for good), never while the browser is offline, and never after the SDK's
    own timeout.
    Unload requests (`sendBeacon`) use the alias until the path is known, because they cannot report a status.
  - `'versioned'`: always the versioned path (Beacon ≥ 1.147).
  - `'legacy'`: always the unversioned alias.
  
  Security (audit LO-M2, Low): the fetch transport never follows redirects (`redirect: 'manual'`, set after
  `fetchInit` so it cannot be overridden); a `3xx` or an opaque redirect is a failed send. In 0.1.0, Node's `fetch`
  followed a 307/308 from the Beacon URL and forwarded `X-Beacon-Auth` (the DSN secret) and the body to the redirect
  target. Affected: `@nowo-tech/beacon-node` < 0.2.0 (and `@nowo-tech/beacon-core` < 0.2.0 used from Node with a DSN
  secret); browsers never send the secret. Fixed in 0.2.0.
  
  `ParsedDsn.envelopeUrl()` and `otlpUrl()` now return the versioned URLs; the default parser adds
  `legacyEnvelopeUrl()` / `legacyOtlpUrl()` (optional members: a custom parser without them never falls back), and
  `otlpEndpoint(dsn, legacy?)` gives an OTLP/HTTP exporter base URL.
  
  Size gates: core 11 → 11.3 kB, core + browser 14.5 → 14.8 kB, IIFE 17.5 → 17.8 kB (gzip), for the path fallback, its
  cache, the route-proof rule and self-heal (audit LO-M1), the bounded opaque fallback (LO-L2) and the redirect refusal
  (LO-M2). Measured after the change: core 11.27 kB, core + browser 14.79 kB, IIFE 17.78 kB, offline queue unchanged at
  1.02 kB.

## 0.1.0

First release.
