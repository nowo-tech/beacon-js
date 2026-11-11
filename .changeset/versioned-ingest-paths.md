---
'@nowo-tech/beacon-core': minor
'@nowo-tech/beacon-browser': minor
'@nowo-tech/beacon-node': minor
'@nowo-tech/beacon-express': minor
---

Envelopes go to Beacon's versioned ingest path `/api/ingest/v1/{projectId}/envelope/` (Beacon 1.147, D-20261110-04)
and still work with any older Beacon. New `ingestPaths` option (`<beacon-reporter ingest-paths="…">`):

- `'auto'` (default): the versioned path first. When the server does not know it (`404` or `405`; in the browser
  also an opaque failure, because an old Beacon's `404` carries no CORS headers), the same envelope is sent once to
  the unversioned alias `/api/{projectId}/envelope/`, which Beacon keeps as a permanent alias. The answer is
  remembered per DSN for the life of the page or process (a bounded module-level cache of 32 entries,
  `resetIngestPaths()` clears it), so later envelopes go straight to the right path. Any other answer (`2xx`, `400`,
  `401`, `403`, `413`, `429`, `5xx`) is final: an envelope that Beacon accepted or refused is never sent twice.
  Unload requests (`sendBeacon`) use the alias until the path is known, because they cannot report a status.
- `'versioned'`: always the versioned path (Beacon ≥ 1.147).
- `'legacy'`: always the unversioned alias.

`ParsedDsn.envelopeUrl()` and `otlpUrl()` now return the versioned URLs; the default parser adds
`legacyEnvelopeUrl()` / `legacyOtlpUrl()` (optional members: a custom parser without them never falls back), and
`otlpEndpoint(dsn, legacy?)` gives an OTLP/HTTP exporter base URL.

Size gates: core 11 → 11.2 kB, core + browser 14.5 → 14.7 kB, IIFE 17.5 → 17.7 kB (gzip), for the path fallback and
its cache. Measured after the change: core 11.09 kB, core + browser 14.6 kB, IIFE 17.6 kB, offline queue unchanged at
1.02 kB.
