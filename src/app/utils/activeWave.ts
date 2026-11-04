import type { CategoryProps } from "@/types/types";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES } from "../race/[id]/schedule/Schedule";

/**
 * The wave (other than `wave`) that is still running in this race, or null.
 * Only one wave may run at a time (StartManager + the server engine enforce it);
 * this names it, so the screen can say which one to finish first. Same schedule
 * (buildSchedule) as the Race page, so the number matches the wave cards.
 */
export function runningWaveOtherThan(raceCategories: CategoryProps[], wave: number): number | null {
  const schedule = buildSchedule(raceCategories, DEFAULT_WAVE_GAP_MINUTES);
  for (const w of [...schedule.keys()].sort((a, b) => a - b)) {
    if (w === wave) continue;
    const cats = [...(schedule.get(w)?.values() ?? [])].flat();
    if (cats.some((c) => c.status === "running")) return w;
  }
  return null;
}
