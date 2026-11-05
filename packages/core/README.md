# @nowo-tech/beacon-core

Core of the Beacon SDK, with zero runtime dependencies: the event model, the Sentry-compatible envelope encoder
(exact `length`, single-line payloads), the DSN parser and auth providers, scopes, the fetch transport with
`Retry-After` / `X-Beacon-Rate-Limit` backoff, the self-throttle, `client_report`, scrubbing, IP stripping and
truncation.

Most apps install [`@nowo-tech/beacon-browser`](../browser) or [`@nowo-tech/beacon-node`](../node), which re-export
this package's API. Use core directly only to build a runtime integration (`initClient(options, platformConfig)`).

See the [repository README](../../README.md) and [docs](../../docs/USAGE.md).
