# Spec-driven development

In this repository, **spec-driven development** has three layers that stay in sync:

1. **GitHub Spec Kit baseline**: [`specs/001-baseline/`](../specs/001-baseline/)
   ([`spec.md`](../specs/001-baseline/spec.md), [`code-inventory.md`](../specs/001-baseline/code-inventory.md)),
   initialized with [GitHub Spec Kit](https://github.com/github/spec-kit) (`.specify/`, **Cursor Agent** skills in
   `.cursor/skills/speckit-*`). The inventory maps **100%** of production code in `packages/*/src/`. How to install,
   initialize and use Spec Kit: [`SPEC-KIT.md`](SPEC-KIT.md).
2. **Product behavior**: what the four packages guarantee to applications (see [`USAGE.md`](USAGE.md),
   [`CONFIGURATION.md`](CONFIGURATION.md), [`PRIVACY.md`](PRIVACY.md), [`INSTALLATION.md`](INSTALLATION.md)).
   **Vitest** (100% coverage gate), the **mock Beacon** and **golden envelopes**, and the **Node / Playwright e2e**
   suites enforce the contracts in CI.
3. **Traceability anchors**: stable **`REQ-*`** identifiers in the Makefile and scripts so changes to tooling stay
   discoverable from issues and PRs.

There is no separate executable spec language (for example Gherkin); Spec Kit specs, tests and the golden set are the
mechanical proof alongside this document.

## Table of contents

- [User stories](#user-stories)
- [Functional scope](#functional-scope)
- [Validating the functional spec](#validating-the-functional-spec)
- [Requirement identifiers (`REQ-*`)](#requirement-identifiers-req-)
- [Suggested workflow for contributors](#suggested-workflow-for-contributors)
- [GitHub Spec Kit (summary)](#github-spec-kit-summary)
- [See also](#see-also)

## User stories

| ID    | Story                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| US-01 | **As a** front-end developer, **I want** browser errors reported to Beacon with one `init` call or a `<beacon-reporter>` tag **so that** I see them without running a backend. |
| US-02 | **As a** Node / Express developer, **I want** uncaught errors and failed requests reported with request context **so that** server errors are grouped in Beacon.               |
| US-03 | **As a** DPO, **I want** the SDK to never send IPs, cookies or credentials **so that** error tracking stays within data minimisation.                                          |
| US-04 | **As an** operator, **I want** rate limits, throttling and queues honoured **so that** a burst of errors never overloads Beacon or the page.                                   |
| US-05 | **As a** maintainer, **I want** wire compatibility proven by a golden envelope set **so that** Beacon and the SDK never drift apart.                                           |

## Functional scope

**In scope (npm API):** the exports of `@nowo-tech/beacon-core`, `-browser` (including `/element` and `/offline`),
`-node` and `-express`, documented in their `etc/*.api.md` reports; the `<beacon-reporter>` element; the IIFE build
`beacon.min.js` attached to each GitHub release.

**Explicit non-goals:** tracing, session replay, framework adapters other than Express (see
[`FRAMEWORKS.md`](FRAMEWORKS.md)), sending the user's IP.

## Validating the functional spec

```sh
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test && pnpm test:mock
pnpm e2e:node && pnpm e2e:browser
pnpm size && pnpm pack:check && pnpm golden:check
make release-check   # the same chain in Docker plus the git hygiene checks
```

## Requirement identifiers (`REQ-*`)

| ID           | Where                                                  | Meaning                                      |
| ------------ | ------------------------------------------------------ | -------------------------------------------- |
| REQ-GIT-001  | `.githooks/commit-msg`, `.scripts/check-no-*-coauthor` | No AI co-author trailers in commits          |
| REQ-REL-003  | `.scripts/check-open-prs.sh`                           | No unresolved open pull request before a tag |
| REQ-MAKE-002 | `make release-check`                                   | Full pre-release chain                       |
| REQ-TEST-009 | `.scripts/ts-coverage-percent.sh`                      | One global TS coverage percentage            |

## Suggested workflow for contributors

1. Describe the change in a spec (`/speckit-specify`) or update `specs/001-baseline/spec.md`.
2. Implement it with tests (100% coverage per package).
3. Update `code-inventory.md` for new or removed files under `packages/*/src/`.
4. Add a changeset for user-visible changes.

## GitHub Spec Kit (summary)

Spec Kit is initialized with `cursor-agent`; the operator manual is [`SPEC-KIT.md`](SPEC-KIT.md).

## See also

- [`specs/001-baseline/spec.md`](../specs/001-baseline/spec.md)
- [`specs/001-baseline/code-inventory.md`](../specs/001-baseline/code-inventory.md)
- [`ENGRAM.md`](ENGRAM.md)
