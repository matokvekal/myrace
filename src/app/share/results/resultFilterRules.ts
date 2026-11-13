/**
 * RESULTS presentation filters (public page 2.0). Hide rows and categories only: official
 * order, positions, times, approvals and podium eligibility are never recalculated.
 *
 *  - Only Finishers: riders who finished on course (not DNF/DSQ/DNS, not still racing);
 *    categories without any finisher are hidden.
 *  - Filter by Wave: only categories of the chosen wave (`category.heat`).
 */
import type { SharedCategory } from "../../../shared/race/state";
import type { PublicRider } from "../usePublicRaceFeed";
import { categoryKey, isFinishedRider, waveKeyOf } from "../waves/activeWaves";

export interface ResultsFilterState {
  onlyFinishers: boolean;
  byWave: boolean;
  wave: string | null;
}

export const NO_RESULTS_FILTER: ResultsFilterState = { onlyFinishers: false, byWave: false, wave: null };

export function filterResultRiders<T extends PublicRider>(list: T[], f: Pick<ResultsFilterState, "onlyFinishers">): T[] {
  return f.onlyFinishers ? list.filter(isFinishedRider) : list;
}

/** The categories to show, in their given order. */
export function filterResultCategories(
  categories: SharedCategory[],
  byCategory: Map<string, PublicRider[]>,
  f: ResultsFilterState,
): SharedCategory[] {
  return categories.filter((c) => {
    if (f.byWave && f.wave != null && waveKeyOf(c) !== f.wave) return false;
    if (f.onlyFinishers && !(byCategory.get(categoryKey(c.name, c.subCategory)) ?? []).some(isFinishedRider)) return false;
    return true;
  });
}

/** Waves present among these categories, in wave order. */
export function resultWaves(categories: SharedCategory[]): string[] {
  const keys = [...new Set(categories.map(waveKeyOf))];
  return keys.sort((a, b) => (a === "—" ? 1 : b === "—" ? -1 : Number(a) - Number(b)));
}
