---
---

Size gates after the security delta review (FVD): core 10.5 → 11 kB, core + browser 14 → 14.5 kB, IIFE 17 →
17.5 kB (gzip). The growth comes from the word-boundary client-address header check, card numbers sent as JSON
numbers, and the NFKC + look-alike folding of scrubber keys (the confusables map is most of it). Measured: core
10.41 → 10.79 kB, core + browser 13.91 → 14.31 kB, IIFE 16.72 → 17.17 kB, offline queue unchanged at 1.02 kB.
