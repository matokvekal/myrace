/** Whole days from the race date to today: 0 on race day, > 0 after it, < 0 before. Unreadable date = 0. */
export function daysSinceRace(date: string | undefined, today = new Date()): number {
  if (!date) return 0;
  const iso = date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const local = date.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  const race = iso
    ? new Date(+iso[1], +iso[2] - 1, +iso[3])
    : local
      ? new Date(+local[3], +local[2] - 1, +local[1])
      : new Date(date);
  if (Number.isNaN(race.getTime())) return 0;
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(race.getFullYear(), race.getMonth(), race.getDate());
  return Math.round((day.getTime() - start.getTime()) / 86_400_000);
}

interface WaveCheck {
  state: "upcoming" | "running" | "finished";
  /** Scheduled start, minutes since midnight. */
  start: number;
  now: number;
  daysSinceRace: number;
  hasBibIssue: boolean;
  /** Riders not yet checked in. */
  missing: number;
}

/** What's wrong with a wave, for its light-red card; null = all good (green). */
export function waveProblem({ state, start, now, daysSinceRace: days, hasBibIssue, missing }: WaveCheck): string | null {
  if (state === "finished") return null;
  if (days > 0) return state === "running" ? "Not finished" : "Not started";
  if (state === "running") return null;
  if (days === 0 && now > start) return "Not started";
  if (hasBibIssue) return "Bib problem";
  if (missing > 0) return "Check-In";
  return null;
}
