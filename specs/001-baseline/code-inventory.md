# Code inventory: 100% traceability

**Baseline spec**: [`spec.md`](spec.md)  
**Packages**: `@nowo-tech/beacon-core`, `@nowo-tech/beacon-browser`, `@nowo-tech/beacon-node`, `@nowo-tech/beacon-express`  
**Last audited**: 2026-11-16

Scope: every production source file under `packages/*/src/` (what the build bundles and publishes in `dist/`). Tests,
`e2e/`, `fixtures/` and `tooling/` are out of scope. Audit command: `git ls-files 'packages/*/src/*' | wc -l` → **51**.

## Core: public API

| Source file                    | Spec section     | Requirement IDs          |
| ------------------------------ | ---------------- | ------------------------ |
| `packages/core/src/api.ts`     | Core: public API | FR-CORE-001, FR-CORE-002 |
| `packages/core/src/client.ts`  | Core: public API | FR-CORE-002, FR-CORE-003 |
| `packages/core/src/index.ts`   | Core: public API | FR-CORE-001              |
| `packages/core/src/scope.ts`   | Core: public API | FR-CORE-004              |
| `packages/core/src/types.ts`   | Core: public API | FR-CORE-005              |
| `packages/core/src/utils.ts`   | Core: public API | FR-CORE-005              |
| `packages/core/src/version.ts` | Core: public API | FR-CORE-005              |

## Core: DSN, auth and ingest paths

| Source file                         | Spec section                     | Requirement IDs |
| ----------------------------------- | -------------------------------- | --------------- |
| `packages/core/src/auth.ts`         | Core: DSN, auth and ingest paths | FR-DSN-002      |
| `packages/core/src/dsn.ts`          | Core: DSN, auth and ingest paths | FR-DSN-001      |
| `packages/core/src/ingest-paths.ts` | Core: DSN, auth and ingest paths | FR-DSN-003      |

## Core: event model

| Source file                        | Spec section      | Requirement IDs |
| ---------------------------------- | ----------------- | --------------- |
| `packages/core/src/dedupe.ts`      | Core: event model | FR-EVT-004      |
| `packages/core/src/exception.ts`   | Core: event model | FR-EVT-001      |
| `packages/core/src/fingerprint.ts` | Core: event model | FR-EVT-003      |
| `packages/core/src/normalize.ts`   | Core: event model | FR-EVT-005      |
| `packages/core/src/stack.ts`       | Core: event model | FR-EVT-002      |
| `packages/core/src/truncate.ts`    | Core: event model | FR-EVT-005      |

## Core: envelope and delivery

| Source file                      | Spec section                | Requirement IDs        |
| -------------------------------- | --------------------------- | ---------------------- |
| `packages/core/src/envelope.ts`  | Core: envelope and delivery | FR-ENV-001             |
| `packages/core/src/queue.ts`     | Core: envelope and delivery | FR-ENV-003             |
| `packages/core/src/ratelimit.ts` | Core: envelope and delivery | FR-ENV-004             |
| `packages/core/src/throttle.ts`  | Core: envelope and delivery | FR-ENV-004             |
| `packages/core/src/transport.ts` | Core: envelope and delivery | FR-ENV-002, FR-SEC-003 |

## Core: privacy and scrubbing

| Source file                    | Spec section                | Requirement IDs |
| ------------------------------ | --------------------------- | --------------- |
| `packages/core/src/privacy.ts` | Core: privacy and scrubbing | FR-SEC-001      |
| `packages/core/src/scrub.ts`   | Core: privacy and scrubbing | FR-SEC-002      |

## Browser SDK

| Source file                              | Spec section | Requirement IDs        |
| ---------------------------------------- | ------------ | ---------------------- |
| `packages/browser/src/delivery.ts`       | Browser SDK  | FR-BRW-002             |
| `packages/browser/src/element-define.ts` | Browser SDK  | FR-BRW-004             |
| `packages/browser/src/element.ts`        | Browser SDK  | FR-BRW-004             |
| `packages/browser/src/index.ts`          | Browser SDK  | FR-BRW-001             |
| `packages/browser/src/init.ts`           | Browser SDK  | FR-BRW-001, FR-SEC-004 |
| `packages/browser/src/offline.ts`        | Browser SDK  | FR-BRW-003             |
| `packages/browser/src/transport.ts`      | Browser SDK  | FR-BRW-002             |

## Browser integrations

| Source file                                            | Spec section         | Requirement IDs |
| ------------------------------------------------------ | -------------------- | --------------- |
| `packages/browser/src/integrations/breadcrumbs.ts`     | Browser integrations | FR-BRW-006      |
| `packages/browser/src/integrations/browser-context.ts` | Browser integrations | FR-BRW-008      |
| `packages/browser/src/integrations/global-handlers.ts` | Browser integrations | FR-BRW-005      |
| `packages/browser/src/integrations/http-errors.ts`     | Browser integrations | FR-BRW-007      |
| `packages/browser/src/integrations/lifecycle.ts`       | Browser integrations | FR-BRW-009      |
| `packages/browser/src/integrations/resource-errors.ts` | Browser integrations | FR-BRW-007      |

## Node SDK

| Source file                       | Spec section | Requirement IDs |
| --------------------------------- | ------------ | --------------- |
| `packages/node/src/file-queue.ts` | Node SDK     | FR-NODE-005     |
| `packages/node/src/filename.ts`   | Node SDK     | FR-NODE-003     |
| `packages/node/src/gzip.ts`       | Node SDK     | FR-NODE-004     |
| `packages/node/src/index.ts`      | Node SDK     | FR-NODE-001     |
| `packages/node/src/init.ts`       | Node SDK     | FR-NODE-001     |
| `packages/node/src/process.ts`    | Node SDK     | FR-NODE-002     |

## Node integrations

| Source file                                       | Spec section      | Requirement IDs |
| ------------------------------------------------- | ----------------- | --------------- |
| `packages/node/src/integrations/console.ts`       | Node integrations | FR-NODE-008     |
| `packages/node/src/integrations/context-lines.ts` | Node integrations | FR-NODE-009     |
| `packages/node/src/integrations/context.ts`       | Node integrations | FR-NODE-009     |
| `packages/node/src/integrations/http.ts`          | Node integrations | FR-NODE-008     |
| `packages/node/src/integrations/isolation.ts`     | Node integrations | FR-NODE-007     |
| `packages/node/src/integrations/rejection.ts`     | Node integrations | FR-NODE-002     |
| `packages/node/src/integrations/shutdown.ts`      | Node integrations | FR-NODE-006     |
| `packages/node/src/integrations/uncaught.ts`      | Node integrations | FR-NODE-002     |

## Express middleware

| Source file                     | Spec section       | Requirement IDs        |
| ------------------------------- | ------------------ | ---------------------- |
| `packages/express/src/index.ts` | Express middleware | FR-EXP-001, FR-SEC-001 |

## Coverage summary

| Category                         | Files  |
| -------------------------------- | ------ |
| Core: public API                 | 7      |
| Core: DSN, auth and ingest paths | 3      |
| Core: event model                | 6      |
| Core: envelope and delivery      | 5      |
| Core: privacy and scrubbing      | 2      |
| Browser SDK                      | 7      |
| Browser integrations             | 6      |
| Node SDK                         | 6      |
| Node integrations                | 8      |
| Express middleware               | 1      |
| **Total production sources**     | **51** |

Mapped 51 / 51 files under `packages/*/src/` (100%). Build outputs (`dist/`, API reports in `packages/*/etc/`) are generated from these sources.
