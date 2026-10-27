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


export interface GroupSignals {
  /** Groups whose first rider has started their final lap — every active rider shows the bell. */
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
    // The whole category / Finish Group, whatever each rider's distance or wave.
    const key = categoryGroupKey(cat);
    for (const r of riders) {
      if (!riderInCategory(r, cat) || OUT_STATUSES.includes(r.status as string)) continue;
      // Category laps first — the shared rule (effectiveTotalLaps).
      const laps = cat.laps || r.totalLaps || 0;
      if (laps <= 0 || r.lapsCounter <= 0) continue;
      // Finish needs the FULL lap count — a rider flagged finished early (manual
      // or by a group flag) with fewer laps must not trigger anything.
      if (r.lapsCounter >= laps && r.raceStatus === "finished") finish.add(key);
      // On (or past, if the laps were lowered) the final lap: the bell for everyone.
      else if (r.raceStatus !== "finished" && laps - r.lapsCounter <= 1) bell.add(key);
    }
  }
  return { bell, finish };
}

