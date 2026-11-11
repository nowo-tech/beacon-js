/**
 * Which ingest paths the client uses (Beacon D-20261110-04):
 * - `'auto'` (default): the versioned path `/api/ingest/v1/{projectId}/…` first, and the unversioned alias
 *   `/api/{projectId}/…` once when the server does not know the versioned one (Beacon < 1.147); the answer is
 *   remembered per DSN for the life of the page / process.
 * - `'versioned'`: always the versioned path (Beacon ≥ 1.147).
 * - `'legacy'`: always the unversioned alias, which every Beacon serves permanently.
 */
export type IngestPaths = 'auto' | 'versioned' | 'legacy';

/** How many Beacon targets (DSN origin + project) the path cache remembers; the oldest entry is evicted first. */
export const INGEST_PATH_CACHE_SIZE = 32;

// Module-level on purpose: keyed by the DSN's unversioned envelope URL (origin + path prefix + project id), the answer
// describes a Beacon server, never a user or a request, and it is bounded, so it is safe in long-lived Node workers.
const resolved = new Map<string, 'versioned' | 'legacy'>();

/** The path a Beacon target (its unversioned envelope URL) is known to serve, if a previous send found out. */
export const knownIngestPath = (target: string): 'versioned' | 'legacy' | undefined =>
  resolved.get(target);

/** Remembers the path a Beacon target serves (bounded to {@link INGEST_PATH_CACHE_SIZE} entries). */
export function rememberIngestPath(target: string, path: 'versioned' | 'legacy'): void {
  resolved.delete(target);
  if (resolved.set(target, path).size > INGEST_PATH_CACHE_SIZE)
    resolved.delete(resolved.keys().next().value!);
}

/** Forgets every remembered target (tests, or after a Beacon upgrade without a restart). */
export function resetIngestPaths(): void {
  resolved.clear();
}
