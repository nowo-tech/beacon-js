---
---

`compression` now defaults to `false` in the browser and Node SDKs: envelopes are sent uncompressed. Beacon's ingest
decompresses `Content-Encoding: gzip` only from Beacon 1.143 on. `compression: 'auto'` stays available as an explicit
opt-in (browser: gzip over 32 kB, Node: over 1 kB) and requires Beacon ≥ 1.143.
