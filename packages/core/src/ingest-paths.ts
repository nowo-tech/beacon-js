/**
 * Which ingest paths the client uses (Beacon D-20261110-04):
 * - `'auto'` (default): the versioned path `/api/ingest/v1/{projectId}/…` unless the target is known to serve the
 *   unversioned alias `/api/{projectId}/…` only; on `404`/`405` the same envelope goes once to the alias. What a
 *   target serves is remembered per DSN for the life of the page / process, learned only from proof (a `2xx` or a
 *   Beacon `400`/`401`/`403`/`413`/`415`/`422`).
 * - `'versioned'`: always the versioned path (Beacon ≥ 1.147).
 * - `'legacy'`: always the unversioned alias, which every Beacon serves permanently.
 */
export type IngestPaths = 'auto' | 'versioned' | 'legacy';

/**
 * What the client knows about a target: the path it serves, or `'opaque'` once a browser opaque failure was already
 * re-sent to the alias without an answer (no further opaque fallback for that target for
 * {@link OPAQUE_FALLBACK_TTL_MS}).
 */
export type KnownIngestPath = 'versioned' | 'legacy' | 'opaque';

/** How many Beacon targets (DSN origin + project) the path cache remembers; the oldest entry is evicted first. */
export const INGEST_PATH_CACHE_SIZE = 32;

/** 4xx statuses that only a Beacon ingest controller emits, so the route exists. */
export const ROUTE_PROOF_STATUSES: readonly number[] = [400, 401, 403, 413, 415, 422];

/**
 * Whether an answer proves that the route exists: `2xx`, or a Beacon `400`/`401`/`403`/`413`/`415`/`422`. `408`,
 * `429`, `5xx` and other statuses can come from a proxy, a load balancer or an outage in front of any Beacon version,
 * so they prove nothing (audit LO-M1). Same rule as beacon-php and BeaconBundle.
 */
export const provesRoute = (status: number): boolean =>
  (status >= 200 && status < 300) || ROUTE_PROOF_STATUSES.includes(status);

/** `404` / `405`: the server has no such ingest route (Beacon < 1.147). */
export const isMissingRoute = (status: number | undefined): boolean =>
  status === 404 || status === 405;

/**
 * How long an `'opaque'` marker lives (audit LOD-L1): both paths failing opaquely can also be a network outage, so the
 * opaque fallback is tried again after this delay instead of never (which, against Beacon < 1.147, would leave the
 * page sending to the versioned path only and disable the client after three opaque failures).
 */
export const OPAQUE_FALLBACK_TTL_MS = 5 * 60_000;

// Module-level on purpose: keyed by the DSN's unversioned envelope URL (origin + path prefix + project id), the answer
// describes a Beacon server, never a user or a request, and it is bounded, so it is safe in long-lived Node workers.
const resolved = new Map<string, [path: KnownIngestPath, until: number]>();

/** What a Beacon target (its unversioned envelope URL) is known to serve, if a previous send found out. */
export function knownIngestPath(target: string, now = Date.now()): KnownIngestPath | undefined {
  const entry = resolved.get(target);
  return entry && entry[1] > now ? entry[0] : undefined;
}

/**
 * Remembers the newest answer for a Beacon target (bounded to {@link INGEST_PATH_CACHE_SIZE} entries). `'opaque'`
 * expires after {@link OPAQUE_FALLBACK_TTL_MS}; a path never expires.
 */
export function rememberIngestPath(target: string, path: KnownIngestPath, now = Date.now()): void {
  resolved.delete(target);
  if (
    resolved.set(target, [path, path === 'opaque' ? now + OPAQUE_FALLBACK_TTL_MS : Infinity]).size >
    INGEST_PATH_CACHE_SIZE
  )
    resolved.delete(resolved.keys().next().value!);
}

/** Forgets one target (self-heal after a `404`/`405` on a path it was known to serve). */
export function forgetIngestPath(target: string): void {
  resolved.delete(target);
}

/** Forgets every remembered target (tests, or after a Beacon upgrade without a restart). */
export function resetIngestPaths(): void {
  resolved.clear();
}
