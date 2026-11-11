# Releasing

The four packages — `@nowo-tech/beacon-core`, `@nowo-tech/beacon-browser`, `@nowo-tech/beacon-node` and
`@nowo-tech/beacon-express` — are versioned together and published to npm by GitHub Actions, never from a laptop.

## Steps

Publishing is three steps; everything after the tag is automatic:

1. **Bump the four versions.** `packages/{core,browser,node,express}/package.json` all get the same version
   (`pnpm changeset version` applies the pending changesets), with `CHANGELOG` / `UPGRADING` updated.
2. **Merge** that change to `main` through a pull request with green CI.
3. **Push an annotated tag** `vX.Y.Z` on the merge commit (`git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`).

The `Release` workflow (`.github/workflows/release.yml`) then runs on the tag. It checks that every package version
equals the tag, builds, packs, **publishes to npm** `@nowo-tech/beacon-core`, `-browser`, `-node` and `-express` in
that order with `--provenance`, and **creates the GitHub release** with `beacon.min.js`, `beacon.esm.min.js`, their
maps, `golden-envelopes.tar.gz` and checksums. Versions already on npm are skipped, so a failed run can be re-run.

## Workflow details

Running the workflow by hand is a dry run (`dry_run: true`); it publishes only from a `v*` tag ref with
`dry_run: false`. Publishing always needs the repository variable `NPM_PUBLISH_ENABLED` to be `true`; set it to
`false` to pause releases.

## Authentication

If the `npm-publish` environment has an `NPM_TOKEN` secret, it is used; otherwise the workflow
uses npm trusted publishing (OIDC). Trusted publishing needs each package to exist on npm first, hence a one-time
bootstrap with a token (done for 0.1.0 on 2026-11-09):

1. **Token, first publish.** A granular access token on npmjs.com with publish rights limited to the `@nowo-tech`
   scope and a short expiry, stored only as the `NPM_TOKEN` secret of the `npm-publish` environment.
2. **Trusted publishers.** On npmjs.com, for each of the four packages, add a trusted publisher: GitHub Actions,
   repository `nowo-tech/beacon-js`, workflow `release.yml`, environment `npm-publish`.
3. **Delete the token.** Remove the `NPM_TOKEN` secret from the environment and revoke the token on npmjs.com.
   From then on every release uses OIDC trusted publishing, and no long-lived npm credential exists.

Repository settings that releases rely on (environment `npm-publish`, tag ruleset, branch protection) are listed in
[CONTRIBUTING](../CONTRIBUTING.md#required-github-settings-owner-before-publishing).
