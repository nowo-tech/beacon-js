# Upgrading

## Unreleased (0.2.0)

Envelopes now go to Beacon's versioned ingest path `/api/ingest/v1/{projectId}/envelope/` (Beacon 1.147). Nothing to
change for most applications: the default `ingestPaths: 'auto'` falls back once to the unversioned
`/api/{projectId}/envelope/` (a permanent alias) when the server is older, and remembers the answer per DSN. Against
an older Beacon the first envelope of each page or process costs one extra request (a `404`); set
`ingestPaths: 'legacy'` (`ingest-paths="legacy"` on `<beacon-reporter>`) to skip it, or `'versioned'` once every
Beacon you report to is 1.147 or later.

- `ParsedDsn.envelopeUrl()` and `otlpUrl()` return the versioned URLs. Code that posts to them itself against a
  Beacon older than 1.147 should use the new `legacyEnvelopeUrl()` / `legacyOtlpUrl()` of the default parser, or
  `otlpEndpoint(dsn, true)` for an OTLP exporter.
- A custom `dsnParser` keeps working; without `legacyEnvelopeUrl()` the client sends to its `envelopeUrl()` only.
- Content Security Policy: `connect-src` already allows the Beacon origin; the path changes nothing there.
- Tests that assert envelope URLs, or that run several fake servers on one DSN, can call `resetIngestPaths()`
  between cases.

## 0.1.0

First release. Nothing to upgrade from.

`compression` defaults to `false`: envelopes are sent uncompressed, because Beacon's ingest decompresses
`Content-Encoding: gzip` only from Beacon 1.143 on. Set `compression: 'auto'` to gzip large bodies (browser over 32 kB,
Node over 1 kB) once your Beacon is 1.143 or later; against an older Beacon a gzipped envelope cannot be read.

The packages stay on `0.x` until Beacon ships spec 172 blocks A–C; minor versions may contain breaking changes until
1.0, and each one is listed here.
