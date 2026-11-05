import type { CategoryProps, RiderProps } from "@/types/types";
import { riderInCategory } from "../../schedule/Schedule";

/**
 * Category filter options on Live: the wave's categories that actually have
 * riders of this race in them, with the count. Running first, then finished,
 * then not started (shown greyed). A category the schedule puts in the wave but
 * with nobody in it is not an option.
 */
export function liveFilterOptions(
  waveCategories: CategoryProps[],
  riders: RiderProps[],
  raceUuid: string,
): { cat: CategoryProps; riders: number }[] {
  const rank = (status?: string) => (status === "running" ? 0 : status === "finished" ? 1 : 2);
  const raceRiders = riders.filter((r) => r.raceUuid === raceUuid);
  return waveCategories
    .map((cat) => ({ cat, riders: raceRiders.filter((r) => riderInCategory(r, cat)).length }))
    .filter((x) => x.riders > 0)
    .sort((a, b) => rank(a.cat.status) - rank(b.cat.status));
}
