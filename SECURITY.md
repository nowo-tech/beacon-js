# Security policy

## Reporting a vulnerability

Please report vulnerabilities **privately** through
[GitHub Security Advisories](https://github.com/nowo-tech/beacon-js/security/advisories/new). Do not open a public
issue. We acknowledge reports within **72 hours**, and we publish an advisory once a fix is released.

## Supported versions

| Version                | Supported |
| ---------------------- | --------- |
| latest minor (`0.1.x`) | yes       |
| older                  | no        |

## Scope notes

- The browser key (`bk_…`) is public by design. Protection is server-side (origin allow-list, CORS, limits).
- The SDK never sends the user's IP, scrubs credentials before sending, never puts credentials in a URL, and refuses a
  server secret in the browser build.
- Never paste a real DSN, key or token into an issue, a test or a CI log. Fixtures use obvious fakes only
  (`bk_test_0000…`, `test-secret-not-real`, `golden-secret-not-real`).
