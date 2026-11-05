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

## Scrubbing (default)

- Headers `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-beacon-auth`, `x-api-key`,
  `x-auth-token`, `x-csrf-token`, `x-xsrf-token` → `[Filtered]`.
- Keys matching `pass(word|wd)?|secret|token|api[-_]?key|auth|credential|session|cookie|csrf|xsrf|private[-_]?key|card|cvv|iban|ssn`
  → `[Filtered]`, in `request`, `extra`, `contexts`, `tags` and breadcrumb data.
- Query parameters with those names, and `code`, `state`, `access_token`, `id_token`, `refresh_token`, `sig`,
  `signature`, in every recorded URL; URL fragments are dropped.
- JWTs, `Bearer …` values, `bk_…` keys and long mixed hex/base64url secrets in messages and breadcrumbs.

## CSP

Pages with a Content Security Policy must allow the Beacon origin in `connect-src`
(`connect-src 'self' https://beacon.example`). The IIFE served by Beacon also needs `script-src` for that origin, with
SRI (`integrity="sha384-…"`, `crossorigin="anonymous"`). The SDK uses no `eval`, no `new Function` and no inline
styles; `<beacon-reporter>` uses constructable stylesheets, with a `<style nonce>` fallback (`nonce` attribute).

## Snippet for your privacy notice

> To find and fix errors, this site sends technical error reports to our error-tracking service (Beacon): the page
> URL, the browser and operating system name and version, and the error details. No IP address, cookies or form
> contents are included in these reports.
