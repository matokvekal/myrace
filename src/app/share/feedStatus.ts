/**
 * Is the public feed's data still current? (public page 2.0)
 * LIVE and the TV broadcast never show old standings as if they were current.
 *
 *  - offline (last request failed)            → stale
 *  - polling stopped while the race is not finished (live updates ended) → ended
 *  - no answer for 2 refresh intervals + 10 s grace → stale
 */
export type FeedFreshness = "fresh" | "stale" | "ended";

export const STALE_GRACE_MS = 10_000;

export function feedFreshness(args: {
  offline: boolean;
  updatedAt: number | null;
  delayMs: number | null;
  raceFinished: boolean;
  now: number;
}): FeedFreshness {
  const { offline, updatedAt, delayMs, raceFinished, now } = args;
  if (offline) return "stale";
  if (delayMs == null) return raceFinished ? "fresh" : "ended";
  if (updatedAt == null) return "fresh"; // first load in flight
  return now - updatedAt > delayMs * 2 + STALE_GRACE_MS ? "stale" : "fresh";
}
