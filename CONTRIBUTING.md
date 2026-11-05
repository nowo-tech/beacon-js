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

## Releasing

Publishing is **off** until the owner sets up npm:

1. Create the npm org `@nowo-tech` (2FA required) and publish each package name once by hand
   (`@nowo-tech/beacon-core`, `-browser`, `-node`, `-express`), because trusted publishing needs the package to exist.
2. On npmjs.com, add a trusted publisher for each package: repository `nowo-tech/beacon-js`, workflow
   `release.yml`, environment `npm-publish`.
3. Create the GitHub environment `npm-publish` with required reviewers, and set the repository variable
   `NPM_PUBLISH_ENABLED=true`.
4. Run the `Release` workflow with `dry_run: false`. Until then it only builds, packs and uploads the release assets
   (`beacon.min.js`, `beacon.esm.min.js`, their maps, `golden-envelopes.tar.gz` and checksums) as artifacts.

If a token is preferred over trusted publishing, use a granular automation token limited to `@nowo-tech/*`, stored
only as the `NPM_TOKEN` secret of the `npm-publish` environment.
