# Security

The GitHub-facing policy (supported versions, private reporting) is [`.github/SECURITY.md`](../.github/SECURITY.md).
This document is the package-specific analysis: threats, mitigations and the release checklist.

## Table of contents

- [Assets and trust boundaries](#assets-and-trust-boundaries)
- [Threats and mitigations](#threats-and-mitigations)
- [Secrets](#secrets)
- [Dependencies and supply chain](#dependencies-and-supply-chain)
- [Release security checklist](#release-security-checklist)
- [Past advisories](#past-advisories)

## Assets and trust boundaries

- **DSN secret** (`sk` of a Node DSN): authenticates server envelopes. It must stay on the server.
- **Browser key** (`bk_…`): public by design; Beacon protects it with an origin allow-list, CORS and limits.
- **Event data**: may contain personal data or credentials captured from the application.
- **Queued envelopes** at rest: memory, IndexedDB (`nowo-beacon`) in the browser, files in Node.

## Threats and mitigations

| Threat                                              | Mitigation                                                                                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| DSN secret leaks to a browser                       | The browser build refuses a DSN with a secret.                                                                                           |
| DSN secret forwarded to another host by a redirect  | The transport never follows redirects (`redirect: 'manual'`, audit LO-M2, fixed in 0.2.0).                                               |
| Credentials in URLs                                 | Credentials are never put in a URL; `user:pass@`, fragments and credential-like query values are stripped from recorded URLs.            |
| Personal data in events (IP, cookies, auth headers) | The IP is stripped as the last step after `beforeSend` with no opt-out; sensitive headers and keys are filtered ([PRIVACY](PRIVACY.md)). |
| Look-alike keys bypass the scrubber                 | Keys are compared after NFKC normalisation and a Cyrillic / Greek look-alike fold.                                                       |
| Unbounded memory or CPU from huge payloads          | Normalisation limits (depth, keys, arrays, strings), event caps, envelope size caps, throttling and a 50:1 compression ratio cap.        |
| Hanging requests                                    | The fetch transport aborts after its own timeout (default 10 s); flush and shutdown are bounded.                                         |
| File-queue abuse (symlinks, permissions)            | 0700 directory, 0600 files, regular files only, no symlink following, 32-hex event ids as file names.                                    |
| Overloading Beacon                                  | `Retry-After` and rate-limit headers are honoured (max 24 h); token-bucket throttle; per-session cap in the browser.                     |

## Secrets

- No real credentials are committed. Tests and fixtures use obvious fakes (`bk_test_0000…`, `test-secret-not-real`).
- CI runs **gitleaks** on every push and pull request.
- npm publishing uses trusted publishing (OIDC) only; no npm token is stored in the repository or its environments
  ([RELEASE](RELEASE.md)).

## Dependencies and supply chain

- `@nowo-tech/beacon-core` has no runtime dependencies; the other packages depend only on the workspace packages.
- CI runs `pnpm audit` (production dependencies, high and above fail); Dependabot updates npm and GitHub Actions
  weekly; CodeQL and OpenSSF Scorecard run on the repository.
- Releases are built in a job without credentials; the publish job verifies the SHA-256 of the packed tarballs and
  publishes with `--provenance`.

## Release security checklist

Before pushing a `v*` tag:

- [ ] CI green on the release commit (gitleaks, `pnpm audit`, CodeQL included).
- [ ] No open pull request left unresolved (`make check-open-prs`).
- [ ] Security-relevant changes reviewed (AI security audit recorded per REQ-SEC-004).
- [ ] `.github/SECURITY.md` supported-versions table matches the new minor.
- [ ] Package changelogs and `docs/UPGRADING.md` state any security fix and the affected versions.
- [ ] No secret in the diff, fixtures or logs; `.env` files stay untracked.

## Past advisories

- **LO-M2 (Low)**: in 0.1.0, Node's `fetch` followed redirects and forwarded `X-Beacon-Auth` to the redirect target.
  Fixed in 0.2.0; see [UPGRADING](UPGRADING.md#020).
