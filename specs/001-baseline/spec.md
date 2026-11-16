# Feature Specification: beacon-js baseline

**Feature Branch**: `001-baseline`
**Created**: 2026-11-16
**Status**: Baseline (0.2.0)
**Input**: Backfill of the published SDK `@nowo-tech/beacon-{core,browser,node,express}` 0.2.0 (error reporting to
Symfony Beacon with Sentry-compatible envelopes).

Related: [`docs/SPEC-DRIVEN-DEVELOPMENT.md`](../../docs/SPEC-DRIVEN-DEVELOPMENT.md),
[`docs/USAGE.md`](../../docs/USAGE.md), [`docs/CONFIGURATION.md`](../../docs/CONFIGURATION.md),
[`docs/PRIVACY.md`](../../docs/PRIVACY.md), [`code-inventory.md`](code-inventory.md).

## Summary

beacon-js captures errors in browsers and Node.js and sends them to a Symfony Beacon project. The four packages are
versioned together. `beacon-core` has no runtime dependencies and holds the event model, the envelope encoder, the
transport, scopes, scrubbing and truncation. `beacon-browser` adds the browser integrations, the `<beacon-reporter>`
web component and the IIFE build. `beacon-node` adds process handlers, request isolation, HTTP breadcrumbs, opt-in
gzip and a file queue. `beacon-express` is an Express 4 / 5 middleware. Envelopes are valid Sentry envelopes
restricted to a strict subset (one event per envelope, single-line payloads, exact `length`).

## User Scenarios & Testing

### US-1: Report browser errors (P1)

**Given** a page that calls `init({ dsn: 'https://bk_…@host/<uuid>' })` or contains `<beacon-reporter>`, **when** an
uncaught error or unhandled rejection happens, **then** one scrubbed event reaches Beacon with stack frames, breadcrumbs
and browser context, and a DSN that carries a server secret is refused in the browser build.

### US-2: Report Node and Express errors (P1)

**Given** a Node app that calls `init` with a server DSN, **when** an uncaught exception or rejection happens or the
Express middleware sees a failed request, **then** the event carries the route, scrubbed headers and source context,
and each request keeps its own scope.

### US-3: Never leak personal data or credentials (P1)

**Given** default options, **when** an event is built, **then** the user's IP, cookies, authorization headers,
credential-like keys and query values are removed or filtered after `beforeSend`, with no option to send the IP.

### US-4: Deliver reliably without overloading Beacon (P2)

**Given** network failures, rate limits or an older Beacon, **when** events are sent, **then** the SDK honours
`Retry-After`, throttles, queues envelopes (memory, IndexedDB or files, at most 7 days), falls back once from the
versioned ingest path to the legacy alias, and never follows redirects.

### Edge cases

- Pages that unload use `sendBeacon` / keepalive within size limits.
- Envelopes over the size cap are truncated or dropped with a client report.
- A Beacon older than 1.147 answers `404` on the versioned path: one re-send to the alias, remembered per DSN.

## Requirements

### Core: public API

- **FR-CORE-001**: The packages export `init`, `captureException`, `captureMessage`, `addBreadcrumb`, `setUser`,
  `setTag`, `withScope`, `flush` and `close` through a global hub (async context strategy pluggable).
- **FR-CORE-002**: The client applies sampling, `ignoreErrors` / `denyUrls` / `allowUrls`, integrations,
  `beforeSend` and `beforeBreadcrumb`, and reports outcomes (`onOutcome`).
- **FR-CORE-003**: Integrations implement `setup`, `processEvent` and `teardown`.
- **FR-CORE-004**: Scopes hold user, tags, extra, contexts and breadcrumbs, cloned per `withScope`.
- **FR-CORE-005**: Shared types, the SDK version (from `package.json` at build time) and UUID helpers.

### Core: DSN, auth and ingest paths

- **FR-DSN-001**: DSNs are parsed and validated (`BeaconConfigError`); browser keys `bk_…`, server `pk:sk`; envelope
  and OTLP URLs (versioned and legacy).
- **FR-DSN-002**: Auth providers build the `X-Beacon-Auth` header or the envelope DSN header.
- **FR-DSN-003**: `ingestPaths` `auto` / `versioned` / `legacy`; learning only from proof, bounded per-DSN cache,
  self-heal on `404` / `405`.

### Core: event model

- **FR-EVT-001**: Errors become exception values with cause chains.
- **FR-EVT-002**: Stack traces of V8, JavaScriptCore and SpiderMonkey are parsed, capped at 64 frames.
- **FR-EVT-003**: Fingerprint values are normalised (UUIDs, numbers, hashes) for grouping.
- **FR-EVT-004**: An event identical to one sent in the last 5 seconds (same exception, frames or message) is dropped.
- **FR-EVT-005**: Values are normalised to JSON-safe data with depth / key / string limits; events are capped.

### Core: envelope and delivery

- **FR-ENV-001**: Envelopes are single-line items with exact byte `length`.
- **FR-ENV-002**: The fetch transport aborts after its own timeout (default 10 s), maps statuses to ok / retry / drop, and never follows redirects
  (`redirect: 'manual'`, audit LO-M2).
- **FR-ENV-003**: The queue keeps unsent envelopes bounded by count, bytes and age.
- **FR-ENV-004**: `Retry-After` / rate-limit headers are honoured (max 24 h); a token bucket throttles sending.

### Core: privacy and scrubbing

- **FR-SEC-001**: Client IPs are stripped as the last step (fields and client-address headers), always.
- **FR-SEC-002**: Sensitive headers, keys, query values and token-like strings are filtered (NFKC + look-alike fold,
  Luhn cards).
- **FR-SEC-003**: Credentials never go into a URL; redirects are refused.
- **FR-SEC-004**: The browser build refuses a DSN that carries a server secret.

### Browser SDK

- **FR-BRW-001**: Browser `init` with browser defaults (throttle 30/min, 200 000-byte envelopes, events per session).
- **FR-BRW-002**: Browser transport: fetch with keepalive, `sendBeacon` on unload, optional `CompressionStream` gzip,
  opaque-failure handling.
- **FR-BRW-003**: Optional offline queue in IndexedDB (`indexedDbQueue()`), replayed when online.
- **FR-BRW-004**: The `<beacon-reporter>` custom element initialises the SDK from attributes; the first connected
  element owns the global client.
- **FR-BRW-005**: Global `error` / `unhandledrejection` handlers.
- **FR-BRW-006**: Console, DOM (selector only, never input values) and navigation breadcrumbs.
- **FR-BRW-007**: Failed HTTP requests (fetch / XHR, configurable status ranges) and resource load errors.
- **FR-BRW-008**: Browser and OS context from the user agent.
- **FR-BRW-009**: Flush on page hide / unload.

### Node SDK

- **FR-NODE-001**: Node `init` with server defaults (throttle 100/min, 1 MiB envelopes, memory queue).
- **FR-NODE-002**: `uncaughtException` / `unhandledRejection` handlers with exit policy.
- **FR-NODE-003**: Filenames relative to `appRoot` for Beacon's in-app grouping.
- **FR-NODE-004**: Opt-in gzip (level 6) for bodies over 1 kB.
- **FR-NODE-005**: File queue (0700 directory, 0600 files, no symlinks, regular files only).
- **FR-NODE-006**: Graceful shutdown with a bounded flush.
- **FR-NODE-007**: One scope per async context (`AsyncLocalStorage`).
- **FR-NODE-008**: Breadcrumbs for outgoing HTTP / fetch (diagnostics channel) and console.
- **FR-NODE-009**: Runtime / OS / app context and source context lines (LRU cache, 1 MiB cap per file).

### Express middleware

- **FR-EXP-001**: Request and error middleware for Express 4 and 5: route, method, allow-listed headers, optional body,
  never client-address, cookie or authorization headers.

## Success Criteria

- **SC-001**: Vitest coverage is 100% statements, branches, functions and lines for every package (CI gate).
- **SC-002**: ESLint (`--max-warnings 0`), Prettier, `tsc`, API Extractor reports and the golden envelope set are clean.
- **SC-003**: Node e2e (Node 20 / 22 / 24) and Playwright e2e (Chromium, Firefox, WebKit) pass against the mock Beacon.
- **SC-004**: size-limit budgets and the pack check (publint, attw, tarball contents) pass.
- **SC-005**: The code inventory maps **51/51** files under `packages/*/src/`.

## Non-goals

- Performance tracing, session replay and framework adapters other than Express (see `docs/FRAMEWORKS.md`).
- Sending the user's IP, in any configuration.
- Publishing from a workstation (releases come only from `v*` tags through `release.yml`).

## Validation

```sh
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test && pnpm test:mock
pnpm e2e:node && pnpm e2e:browser
pnpm size && pnpm pack:check && pnpm golden:check
git ls-files 'packages/*/src/*' | wc -l   # 51, equal to the inventory total
```
