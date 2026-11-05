# beacon-js

TypeScript SDK for [Symfony Beacon](https://github.com/nowo-tech): error reporting from browsers and Node.js.

| Package                     | What it is                                                                      |
| --------------------------- | ------------------------------------------------------------------------------- |
| `@nowo-tech/beacon-core`    | event model, envelope encoder, transport, scopes (zero runtime dependencies)    |
| `@nowo-tech/beacon-browser` | browser SDK, the `<beacon-reporter>` web component, ESM and IIFE builds         |
| `@nowo-tech/beacon-node`    | Node.js SDK (process handlers, HTTP breadcrumbs, request isolation, file queue) |
| `@nowo-tech/beacon-express` | Express 4 and 5 middleware                                                      |

The envelopes stay wire-compatible with Sentry's. Status: pre-release (`0.x`), not published to npm yet.

## License

MIT, see [LICENSE](LICENSE).
