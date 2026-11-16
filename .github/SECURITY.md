# Security Policy

## Supported Versions

| Version                | Supported |
| ---------------------- | --------- |
| latest minor (`0.2.x`) | yes       |
| older                  | no        |

## Reporting a Vulnerability

Please report vulnerabilities **privately** through
[GitHub Security Advisories](https://github.com/nowo-tech/beacon-js/security/advisories/new). Do not open a public
issue. We acknowledge reports within **72 hours**, and we publish an advisory once a fix is released.

Please include the affected package and version, steps to reproduce, the impact and a PoC if available. Never paste a
real DSN, key or token: use obvious fakes.

## Scope notes

- The browser key (`bk_…`) is public by design. Protection is server-side (origin allow-list, CORS, limits).
- The SDK never sends the user's IP, scrubs credentials before sending, never puts credentials in a URL, and refuses a
  server secret in the browser build.
- The transport never follows redirects (`redirect: 'manual'`): a 307/308 would otherwise replay `X-Beacon-Auth`
  (the DSN secret) and the body to another host. A redirect is a failed send that is never re-sent.
- Never paste a real DSN, key or token into an issue, a test or a CI log. Fixtures use obvious fakes only
  (`bk_test_0000…`, `test-secret-not-real`, `golden-secret-not-real`).

For the threat model and the release security checklist, see [docs/SECURITY.md](../docs/SECURITY.md).
