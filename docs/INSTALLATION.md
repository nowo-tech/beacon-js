# Installation

## Table of contents

- [Requirements](#requirements)
- [Browser](#browser)
- [Node.js](#nodejs)
- [Express](#express)
- [Next steps](#next-steps)

## Requirements

- A Symfony Beacon project and its DSN: a public browser key (`https://bk_…@host/<project-uuid>`) for browsers, a
  server key pair (`https://<pk>:<sk>@host/<project-uuid>`) for Node.
- Node.js ≥ 20 for `@nowo-tech/beacon-node` and `@nowo-tech/beacon-express`; any evergreen browser for
  `@nowo-tech/beacon-browser`.

## Browser

```sh
npm install @nowo-tech/beacon-browser
```

Or load the IIFE build attached to each GitHub release (`beacon.min.js`, with its SRI hash) and use the
`<beacon-reporter>` element; see the [README quick start](../README.md#quick-start).

## Node.js

```sh
npm install @nowo-tech/beacon-node
```

## Express

```sh
npm install @nowo-tech/beacon-express
```

Express 4 and 5 are supported; the package depends on `@nowo-tech/beacon-node`.

## Next steps

- [Usage](USAGE.md) and [Configuration](CONFIGURATION.md).
- [Privacy](PRIVACY.md): what is sent and what is never sent.
