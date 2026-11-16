# Changelog

The four packages are versioned together with [Changesets](https://github.com/changesets/changesets); each package keeps
its own changelog, generated at release time:

- [`@nowo-tech/beacon-core`](../packages/core/CHANGELOG.md)
- [`@nowo-tech/beacon-browser`](../packages/browser/CHANGELOG.md)
- [`@nowo-tech/beacon-node`](../packages/node/CHANGELOG.md)
- [`@nowo-tech/beacon-express`](../packages/express/CHANGELOG.md)

Upgrade notes per version: [UPGRADING](UPGRADING.md). Releases: [GitHub releases](https://github.com/nowo-tech/beacon-js/releases).

Repository-only changes (documentation, tooling, CI) that do not reach npm are not listed in the package changelogs:

## Unreleased (repository only)

- Repository brought to the Nowo REQ catalog (sweep 2026-11-16): `docs/` layout (CONTRIBUTING, UPGRADING and SECURITY
  moved under `docs/` and `.github/`), Code of Conduct, Spec Kit baseline, Cursor rules, Makefile `release-check` and
  git hooks, `sync-releases` workflow, issue and PR templates. No package change.
