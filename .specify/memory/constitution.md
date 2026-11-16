# beacon-js Constitution

## Core Principles

### I. Documented integrator contract
Product behavior lives in `specs/001-baseline/spec.md`, `docs/SPEC-DRIVEN-DEVELOPMENT.md` and the integrator docs
(`docs/USAGE.md`, `docs/CONFIGURATION.md`, `docs/PRIVACY.md`).

### II. Spec-first, test-proven
Vitest (100% per package), the mock Beacon, the golden envelope set and the Node / browser e2e suites are the
mechanical proof. Behavioral changes require tests.

### III. 100% code inventory traceability
Every production file under `packages/*/src/` appears in `specs/001-baseline/code-inventory.md`. New files require
spec updates in the same PR.

### IV. Cursor + Spec Kit
GitHub Spec Kit is initialized with **Cursor Agent** (`cursor-agent`). Skills live in `.cursor/skills/speckit-*`.

### V. Wire compatibility and privacy
Envelopes stay valid Sentry envelopes in Beacon's strict subset. The user's IP is never sent; credentials never go into
a URL; redirects are never followed.

### VI. Small, dependency-free core
`@nowo-tech/beacon-core` has no runtime dependencies; size budgets are raised only through a changeset that says why.

## Governance
Amendments update this file, the baseline spec when principles affect behavior, and a changeset when consumer-visible.

**Version**: 1.0.0 | **Ratified**: 2026-11-16 | **Last Amended**: 2026-11-16
