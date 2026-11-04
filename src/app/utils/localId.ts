/**
 * Local record ids (IndexedDB keyPath "id" for riders, categories and races).
 *
 * Must be unique: two records with the same id overwrite each other in IndexedDB,
 * and the Live board keys cards by id, so a duplicate silently hides a rider.
 * `Date.now() * 1000 + random(1000)` (the old scheme) collided ~16 times when a
 * 183-rider race was pulled from the server in one loop, and `Date.now() + i`
 * overlaps between two batches written a few ms apart.
 *
 * Strictly increasing within the tab; the random low digits keep two tabs or
 * devices apart. Stays below Number.MAX_SAFE_INTEGER for centuries.
 */
let last = 0;

export function newLocalId(): number {
  const candidate = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  last = candidate > last ? candidate : last + 1;
  return last;
}

/** Ids that appear more than once (a damaged local copy). */
export function duplicateIds<T extends { id: number }>(records: T[]): Set<number> {
  const seen = new Set<number>();
  const dup = new Set<number>();
  for (const r of records) (seen.has(r.id) ? dup : seen).add(r.id);
  return dup;
}
