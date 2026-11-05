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

- **Environment `npm-publish`**: required reviewers (at least one owner), deployment branches and tags limited to
  `main` and `v*` tags, and no secrets other than an npm token if trusted publishing is not used.
- **Branch protection on `main`**: pull requests required, the CI checks required, no force pushes, no deletion.
- The `Release` workflow already refuses to run from any branch but `main` (`if: github.ref == 'refs/heads/main'`).
- Bind each npm trusted publisher to **both** `release.yml` and the `npm-publish` environment.
- Optional hardening: move the publish step to a separate job that downloads the packed tarballs and does not run
  `pnpm install`, so that `id-token: write` is never available to dependency code.

## Releasing

Publishing is **off** until the owner turns it on. The `Release` workflow runs by hand from `main` or a `v*` tag
only, is a dry run by default (`dry_run: true`), and publishes only when `dry_run` is false **and** the repository
variable `NPM_PUBLISH_ENABLED` is `true`. It always builds, packs and uploads the release assets (`beacon.min.js`,
`beacon.esm.min.js`, their maps, `golden-envelopes.tar.gz` and checksums) as artifacts. It publishes
`@nowo-tech/beacon-core`, `-browser`, `-node` and `-express` in that order, with `--provenance`.

Authentication: if the `npm-publish` environment has an `NPM_TOKEN` secret, it is used; otherwise the workflow
uses npm trusted publishing (OIDC). Trusted publishing needs each package to exist on npm first, hence a one-time
bootstrap with a token:

1. **Token, first publish.** Create a granular access token on npmjs.com with publish rights limited to the
   `@nowo-tech` scope and a short expiry. Store it only as the `NPM_TOKEN` secret of the `npm-publish` environment
   (set up as in "Required GitHub settings" above), set `NPM_PUBLISH_ENABLED=true`, and run the `Release` workflow
   once from `main` with `dry_run: false`.
2. **Trusted publishers.** On npmjs.com, for each of the four packages, add a trusted publisher: GitHub Actions,
   repository `nowo-tech/beacon-js`, workflow `release.yml`, environment `npm-publish`.
3. **Delete the token.** Remove the `NPM_TOKEN` secret from the environment and revoke the token on npmjs.com.
   From then on every release uses OIDC trusted publishing, and no long-lived npm credential exists.

Between releases, set `NPM_PUBLISH_ENABLED` back to `false` (or leave it, the reviewers on the environment still
gate every run).
