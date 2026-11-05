---
---

The core gate in `.size-limit.json` goes from 10 kB to 10.5 kB because of the security review FV fixes: URL
userinfo and credential-value masking, card-number masking, the client-IP header pattern, the `Retry-After` clamp,
`event_id` validation, DSN key checks and the never-throw guard in `captureException`. Measured (gzip): core 9.86 →
10.33 kB, core + browser 13.31 → 13.83 kB, IIFE 16.06 → 16.64 kB, offline queue 1.01 → 1.02 kB. The other gates
are unchanged. Privacy defaults come before size.
