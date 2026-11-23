# Roadmap

Status of the `@nowo-tech/beacon-*` packages and what is left before `1.0.0`. The plan comes from the beacon-js
contract agreed with Beacon (phasing §12, release rules §10.2) and from Beacon spec 172 ("Browser and Node ingest",
blocks A–D). Status checked on 2026-11-23.

## Status

The four packages are versioned together. Latest release: **v0.2.0** (2026-11-12, npm with provenance).

| Phase (contract §12)                                                                                                                 | Status                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.1: `beacon-core`, `beacon-browser` (with `<beacon-reporter>`), `beacon-node`, `beacon-express`, mock server, golden envelopes, CI | Released: 0.1.0 on npm (2026-11-09, before the repository had tags), then v0.2.0                                                                                                 |
| Versioned ingest paths (Beacon ≥ 1.147), redirects refused (LO-M2), compression off by default                                       | Released (v0.2.0)                                                                                                                                                                |
| Repository REQ sweep (docs layout, Spec Kit baseline, hooks), dev-dependency updates                                                 | Merged, unreleased (repository only, nothing reaches npm)                                                                                                                        |
| Adapters: React, Vue, Angular, Svelte, Fastify, NestJS, Next                                                                         | Not started                                                                                                                                                                      |
| Delivery assets for Beacon to pin (contract §2.3)                                                                                    | Partly done: v0.2.0 attaches `beacon.min.js`, `beacon.esm.min.js`, their maps, `golden-envelopes.tar.gz` and `SHA256SUMS`; `manifest.json` and `sbom.spdx.json` are not attached |
| `beacon-cli` (source maps by debug ID), `beacon-otlp`, `<beacon-feedback>` / `<beacon-status-badge>`, Node `transaction` items       | Not started                                                                                                                                                                      |

Beacon side (spec 172): blocks A (browser keys, allowed domains) and B (abuse limits) shipped in Beacon 1.143.0.
Block C (Beacon serves the pinned browser build, per-platform setup pages) and block D (source-map upload and
resolution) are open.

## Road to 1.0.0 (proposed, pending owner OK)

Nothing below is a commitment until the owner approves it. The contract already says that the packages stay on `0.x`
until Beacon ships spec 172 blocks A–C, that `1.0.0` freezes the public API, and that it comes after one production
adopter has used the SDK for two weeks. The proposed criterion builds on that:

1. **Beacon spec 172 block C shipped**: Beacon serves a pinned `@nowo-tech/beacon-browser` build with SRI from the
   release manifest, so every release attaches the full §2.3 asset set (`manifest.json` and the SBOM included).
2. **Adapter scope decided by the owner**: either the contract's v0.2 adapters (React, Vue, Angular, Svelte, Fastify,
   NestJS, Next) ship before 1.0, or 1.0 covers core, browser, node and express only and the adapters follow as
   1.x minors. The v0.3 items (CLI, OTLP bridge, widgets) depend on block D and would stay after 1.0 in either case.
3. **Public API frozen**: the API Extractor reports (`packages/*/etc/*.api.md`) reviewed and marked stable, and
   every breaking change since 0.1 listed in [UPGRADING](UPGRADING.md).
4. **One production adopter for two weeks** (contract §10.2).
5. **REQ audit**: the applicable REQ subset re-audited at 100 % on the 1.0 candidate (last regrade: COMPLIANT on
   2026-11-18).
6. **REQ-SEC-004**: a delta security review of the 1.0 candidate against v0.2.0 (current coverage: the v0.1.0 review
   and the 0.1.0 → 0.2.0 delta), recorded before the tag.

Open questions for the owner: the adapter scope (point 2) and who counts as the production adopter (point 4).
