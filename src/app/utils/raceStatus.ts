export type RaceStatusKey = "upcoming" | "running" | "finished";

/**
 * Race cards/tiles show a status badge, but `race.status` only ever moves
 * upcoming -> running (StartManager) — nothing ever flips it to "finished" at
 * the race level (only per-category/per-rider). A race whose date is in the
 * past but was never started otherwise shows "Soon" forever, which is wrong
 * once the event day has come and gone. Display-only override: a still-
 * "upcoming" race with a past date reads as finished. Actually running races
 * are left alone regardless of date — that reflects real in-progress state.
 */
export function effectiveRaceStatus(
  status: RaceStatusKey | undefined,
  date?: string
): RaceStatusKey {
  const statusKey = status ?? "upcoming";
  if (statusKey !== "upcoming" || !date) return statusKey;

  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return statusKey;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsed.setHours(0, 0, 0, 0);

  return parsed.getTime() < today.getTime() ? "finished" : statusKey;
}
