# Contributing

## Setup

- Node 22 (see `.nvmrc`) for development; the packages support Node ≥ 20 at runtime.
- pnpm 12 (`corepack enable`, the version is pinned in `packageManager`).
- Or use Docker through the `Makefile` (`make test`, `make e2e`, `make size`).

```sh
pnpm install
pnpm build          # esbuild bundles, tsc declarations, API Extractor roll-up and report (etc/*.api.md)
pnpm test           # Vitest with the 100 % coverage gate (browser package: Vitest browser mode, Chromium)
pnpm test:mock      # mock Beacon + golden envelope conformance
pnpm e2e:node       # Express app against the mock Beacon
pnpm e2e:browser    # Playwright, Chromium + Firefox + WebKit
pnpm size           # size-limit gate
pnpm pack:check     # publint + attw on the packed tarballs
pnpm golden:check   # regenerates fixtures/envelopes/golden and fails on any byte change
```

## Rules

- Conventional Commits, squash merges into `main`.
- **100 % statements, branches, functions and lines** in every published package. A `/* v8 ignore */` needs a reason
  comment and is reviewed.
- A public API change updates `packages/*/etc/*.api.md` (the build writes it; CI fails when it is stale).
- User-visible changes add a changeset (`pnpm changeset`). Raising a size budget needs a changeset that says why.
- No real credentials anywhere. Tests use the fakes listed in `SECURITY.md`.

## Required GitHub settings (owner, before publishing)

These are repository settings, so they are not in the code; set them before `NPM_PUBLISH_ENABLED` is ever `true`:

- **Environment `npm-publish`**: deployments limited to `v*` tags, no required reviewers (the tag is the approval),
  and no secrets: npm trusted publishing (OIDC) only.
- **Tag ruleset `v*`**: only repository admins may create, update or delete `v*` tags.
- **Branch protection on `main`**: pull requests required, the CI checks required, no force pushes, no deletion.
- The `Release` workflow builds only from `main` or a `v*` tag and publishes only from a `v*` tag.
- Bind each npm trusted publisher to **both** `release.yml` and the `npm-publish` environment.
- The `Release` workflow keeps credentials away from dependency code: the `build` job (install, build, pack) has
  no npm credential and no `id-token: write`; the `publish` job only downloads the packed tarballs, checks their
  SHA-256, installs npm by exact version and publishes. It alone uses the `npm-publish` environment.

## Releasing

See [docs/RELEASE.md](docs/RELEASE.md): bump the four versions, merge, push an annotated `v*` tag; the `Release`
workflow publishes to npm and creates the GitHub release.
