import { riderInCategory, catWaveKey } from "../race/[id]/schedule/Schedule";
import type { CategoryProps, RiderProps } from "@/types/types";
import { groupPhase, riderPhase, NO_GROUP_PHASE, type GroupPhase, type PhaseRider, type RiderPhase } from "../../shared/race/finishPhases";

/**
 * Bell / Finish state is controlled PER CATEGORY. Categories only share it when
 * an organiser explicitly gives them the same `linkGroup` (e.g. Israeli Masters
 * that race together but are ranked separately). Names are never used to infer
 * grouping, and a wave never groups its categories.
 *
 * Everything here is DERIVED from rider state, never stored: undoing the
 * triggering lap restores every follower, and a reload recomputes the same.
 * The phases themselves (bell → flag → finish) live in shared/race/finishPhases,
 * which the server engine uses too.
 */

export function categoryGroupKey(cat: Pick<CategoryProps, "name" | "subCategory" | "linkGroup">): string {
  const explicit = cat.linkGroup?.trim().toLowerCase();
  return explicit ? `g:${explicit}` : `c:${catWaveKey(cat.name, cat.subCategory)}`;
}

const OUT_STATUSES = ["DNF", "DSQ", "DNS"];

/** `race.leaderFinishAll` — undefined counts as on, so existing races keep the behaviour. */
export function isLeaderFinishAll(race: { leaderFinishAll?: boolean } | null | undefined): boolean {
  return race?.leaderFinishAll !== false;
}

type PhaseSource = Pick<RiderProps, "category" | "subCategory" | "totalLaps" | "lapsCounter" | "lapsDetails" | "raceStatus" | "status">;

/** A rider as the phase machine sees it: own target (category laps first) and recorded crossings. */
export function toPhaseRider(r: PhaseSource, cat?: Pick<CategoryProps, "laps"> | null): PhaseRider {
  const crossings = (r.lapsDetails ?? [])
    .slice(0, r.lapsCounter || 0)
    .map((l) => new Date(l?.endTime as unknown as string).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  return {
    laps: cat?.laps || r.totalLaps || 0,
    crossings,
    finished: r.raceStatus === "finished",
    out: OUT_STATUSES.includes(r.status as string),
  };
}

/** Bell / first-finish times per group key (category or explicit Finish Group, any wave). */
export function computeGroupPhases(categories: CategoryProps[], riders: PhaseSource[], enabled = true): Map<string, GroupPhase> {
  const byGroup = new Map<string, PhaseRider[]>();
  if (!enabled) return new Map();
  for (const cat of categories) {
    const key = categoryGroupKey(cat);
    const list = byGroup.get(key) ?? [];
    for (const r of riders) if (riderInCategory(r, cat)) list.push(toPhaseRider(r, cat));
    byGroup.set(key, list);
  }
  return new Map([...byGroup].map(([k, list]) => [k, groupPhase(list)]));
}

/** What the official shows this rider at their next crossing (icon + laps to go). */
export function phaseOfRider(r: PhaseSource, categories: CategoryProps[], phases: Map<string, GroupPhase>): RiderPhase {
  const cat = categories.find((c) => riderInCategory(r, c));
  return riderPhase(toPhaseRider(r, cat), (cat && phases.get(categoryGroupKey(cat))) || NO_GROUP_PHASE);
}
