# Privacy

## What is sent

An event carries: `event_id`, `timestamp`, `platform`, `level`, `logger`, `release`, `dist`, `environment`, the
message or the exception (type, value, stack frames: file, function, line, column), breadcrumbs, tags, `extra`,
`user` (only `id` / `username` / `email` when the app sets them), `request` (URL with sensitive query values
filtered, user agent; on Node the method, route and scrubbed headers), `contexts` (browser/OS name and major version,
Node runtime, OS, app memory), and `sdk` (name, version, integrations).

## What is never sent

- **The user's IP.** `user.ip_address`, any `{{auto}}` value, `request.env.REMOTE_ADDR` and the `X-Forwarded-For`,
  `X-Real-IP`, `Forwarded`, `CF-Connecting-IP`, `True-Client-IP` and `X-Client-IP` headers are removed as the very
  last step, after `beforeSend`. There is no option to turn this off. Beacon uses the connection IP for rate limiting
  only.
- Cookies, request bodies and `Authorization` / `Cookie` headers (with `sendDefaultPii: false`, the default).
- Input values and text: click breadcrumbs record a CSS-like selector only.

## Limits of IP stripping

Stripping works on **fields**: `user.ip_address`, `{{auto}}` values, `request.env.REMOTE_ADDR` (any case) and every
request header that can carry a client address (the six of contract §5 plus any name matching
`forwarded|client-ip|real-ip|…-ip|cf-*|fastly-*|x-vercel-*|external-address|true-client`). The Express adapter goes
further and records only an allow-list of headers. An IP literal that the **app itself** writes into `extra`,
`contexts`, tags, breadcrumb data or other `request.env` keys is not detected; do not put addresses there. A
`{{auto}}` nested deeper than 20 levels is not walked.

## Data at rest

- Queued envelopes (memory, IndexedDB `nowo-beacon` in the browser, files in Node) are already scrubbed and stay at
  most 7 days. IndexedDB is readable by any script of the same origin; the file queue uses a 0700 directory and 0600
  files, never follows symlinks and only uses Beacon's 32-hex event ids in file names.
- The IndexedDB byte cap counts UTF-16 code units, so multi-byte text can take up to about 3× the cap in storage.
- With the opt-in `serverEnvelopeDsnAuth`, the server secret is part of every envelope header, so it is also written
  into every file-queue entry. Prefer the default `X-Beacon-Auth` provider when the file queue is on.

## Scrubbing (default)

- Headers `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-beacon-auth`, `x-api-key`,
  `x-auth-token`, `x-csrf-token`, `x-xsrf-token` → `[Filtered]`.
- Keys matching `pass(word|wd)?|secret|token|api[-_]?key|auth|credential|session|cookie|csrf|xsrf|private[-_]?key|card|cvv|iban|ssn`
  → `[Filtered]`, in `request`, `extra`, `contexts`, `tags` and breadcrumb data.
- Query parameters with those names, and `code`, `state`, `access_token`, `id_token`, `refresh_token`, `sig`,
  `signature`, in every recorded URL, and **any** query value that looks like a credential; `user:pass@` and URL
  fragments are dropped. Stack frames never keep the query or fragment of a script URL.
- JWTs, `Bearer …` values, `bk_…` / `sk_…` / `pk_…` / `ghp_…`-like keys, long mixed hex/base64url secrets and
  Luhn-valid card numbers in messages and breadcrumbs. Console breadcrumbs run object arguments through the key
  scrubber before they become text.

## CSP

Pages with a Content Security Policy must allow the Beacon origin in `connect-src`
(`connect-src 'self' https://beacon.example`). The IIFE served by Beacon also needs `script-src` for that origin, with
SRI (`integrity="sha384-…"`, `crossorigin="anonymous"`). The SDK uses no `eval`, no `new Function` and no inline
styles; `<beacon-reporter>` uses constructable stylesheets, with a `<style nonce>` fallback (`nonce` attribute).

## Snippet for your privacy notice

> To find and fix errors, this site sends technical error reports to our error-tracking service (Beacon): the page
> URL, the browser and operating system name and version, and the error details. No IP address, cookies or form
> contents are included in these reports.
