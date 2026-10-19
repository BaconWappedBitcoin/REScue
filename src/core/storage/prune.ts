/** Read-history pruning (research R12): drop >90-day-old records, then keep the newest 50,000. */
export const READ_MAX_THREADS = 50_000;
export const READ_MAX_AGE_MS = 90 * 86_400_000;

export interface ReadRecord {
  lastVisit: number;
  commentCountAtVisit: number;
  seenCommentIds?: string[];
}

export function pruneRead(
  read: Record<string, ReadRecord>,
  now = Date.now(),
): Record<string, ReadRecord> {
  const fresh = Object.entries(read).filter(([, r]) => now - r.lastVisit <= READ_MAX_AGE_MS);
  if (fresh.length > READ_MAX_THREADS) {
    fresh.sort((a, b) => b[1].lastVisit - a[1].lastVisit);
    fresh.length = READ_MAX_THREADS;
  }
  return Object.fromEntries(fresh);
}

/** Generic age-based pruning for timestamp maps (hiddenPosts). */
export function pruneOlderThan(
  map: Record<string, number>,
  maxAgeMs: number,
  now = Date.now(),
): Record<string, number> {
  return Object.fromEntries(Object.entries(map).filter(([, t]) => now - t <= maxAgeMs));
}
