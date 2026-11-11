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

Publishing uses npm trusted publishing (OIDC) only. The `npm-publish` environment has **no secrets**: the bootstrap
token used for the first publish of 0.1.0 (2026-11-09) has been deleted from the environment and revoked on npmjs.com,
and the workflow no longer has a token branch. Each of the four packages has a trusted publisher on npmjs.com bound
to GitHub Actions, repository `nowo-tech/beacon-js`, workflow `release.yml` and environment `npm-publish`.

A brand-new package (a fifth one) cannot use trusted publishing before it exists on npm: publish its first version
by hand with a short-lived granular token, add its trusted publisher, then revoke the token. Never store a token in
the repository or the `npm-publish` environment.

Repository settings that releases rely on (environment `npm-publish`, tag ruleset, branch protection) are listed in
[CONTRIBUTING](../CONTRIBUTING.md#required-github-settings-owner-before-publishing).
