# Upgrading

## 0.1.0

First release. Nothing to upgrade from.

`compression` defaults to `false`: envelopes are sent uncompressed, because Beacon's ingest decompresses
`Content-Encoding: gzip` only from Beacon 1.143 on. Set `compression: 'auto'` to gzip large bodies (browser over 32 kB,
Node over 1 kB) once your Beacon is 1.143 or later; against an older Beacon a gzipped envelope cannot be read.

The packages stay on `0.x` until Beacon ships spec 172 blocks A–C; minor versions may contain breaking changes until
1.0, and each one is listed here.
