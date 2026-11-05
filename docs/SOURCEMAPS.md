# Source maps

Source-map upload (`@nowo-tech/beacon-cli`, bin `beacon-sourcemaps`: `inject`, `upload`, `verify`, debug IDs with a
release + dist fallback) is planned for 0.3, once Beacon ships spec 172 Block D.

Until then, events carry the original `abs_path` of every frame (never normalised) next to the normalised
`filename` used for grouping, so that they can be resolved later. Do not deploy `.map` files publicly.
