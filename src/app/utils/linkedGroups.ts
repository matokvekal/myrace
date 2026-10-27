import { riderInCategory, catWaveKey } from "../race/[id]/schedule/Schedule";
import type { CategoryProps, RiderProps } from "@/types/types";

/**
 * Bell / Finish state is controlled PER CATEGORY. Categories only share it when
 * an organiser explicitly gives them the same `linkGroup` (e.g. Israeli Masters
 * that race together but are ranked separately). Names are never used to infer
 * grouping, and a wave never groups its categories.
 *
 * Everything here is DERIVED from rider state, never stored: undoing the
 * triggering lap restores every follower, and a reload recomputes the same.
 */

export function categoryGroupKey(cat: Pick<CategoryProps, "name" | "subCategory" | "linkGroup">): string {
  const explicit = cat.linkGroup?.trim().toLowerCase();
  return explicit ? `g:${explicit}` : `c:${catWaveKey(cat.name, cat.subCategory)}`;
}

const OUT_STATUSES = ["DNF", "DSQ", "DNS"];

/**
 * The bell / finish key of a rider: their group AND their own lap target. A
 * shared finish ("first finish – all finish", Finish Groups) only joins riders
 * racing the same distance: when a shorter category's leader finishes, riders
 * of a longer category in the same Finish Group keep racing their own laps.
 */
export function riderGroupKey(
  cat: Pick<CategoryProps, "name" | "subCategory" | "linkGroup" | "laps">,
  rider: Pick<RiderProps, "totalLaps">
): string {
  return `${categoryGroupKey(cat)}|laps:${rider.totalLaps || cat.laps || 0}`;
}

export interface GroupSignals {
  /** Groups whose first rider has exactly ONE lap left — everyone shows the bell. */
  bell: Set<string>;
  /** Groups whose first rider completed ALL required laps — followers finish on their next crossing. */
  finish: Set<string>;
}

/** `race.leaderFinishAll` — undefined counts as on, so existing races keep the behaviour. */
export function isLeaderFinishAll(race: { leaderFinishAll?: boolean } | null | undefined): boolean {
  return race?.leaderFinishAll !== false;
}

export function computeGroupSignals(
  categories: CategoryProps[],
  riders: Pick<RiderProps, "category" | "subCategory" | "totalLaps" | "lapsCounter" | "raceStatus" | "status">[],
  enabled = true
): GroupSignals {
  const bell = new Set<string>();
  const finish = new Set<string>();
  if (!enabled) return { bell, finish };
  for (const cat of categories) {
    for (const r of riders) {
      if (!riderInCategory(r, cat) || OUT_STATUSES.includes(r.status as string)) continue;
      const laps = r.totalLaps || cat.laps || 0;
      const key = riderGroupKey(cat, r);
      if (laps <= 0 || r.lapsCounter <= 0) continue;
      // Finish needs the FULL lap count — a rider flagged finished early (manual
      // or by a group flag) with fewer laps must not trigger anything.
      if (r.lapsCounter >= laps) {
        if (r.raceStatus === "finished") finish.add(key);
      } else if (laps - r.lapsCounter === 1) {
        bell.add(key);
      }
    }
  }
  return { bell, finish };
}

