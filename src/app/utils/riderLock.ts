/**
 * 0.3.5 — the rider lock after GO, as the app shows it (the server/engine rule is
 * `riderStarted`: the rider's category has a start). Shared races only: there the server
 * refuses a normal edit or delete of a started rider ("locked"), so the editors don't offer
 * one. Names are then fixed through Results → Correct name (audited RiderNameCorrected).
 * Local races keep their editors: nothing on a device-only race refuses the change.
 */
import { isLiveRace } from "@/services/live/liveBridge";
import type { CategoryProps, RiderProps } from "@/types/types";

const sameCategory = (r: Pick<RiderProps, "category" | "subCategory">, c: Pick<CategoryProps, "name" | "subCategory">) =>
  r.category === c.name && (r.subCategory ?? null) === (c.subCategory ?? null);

const riderRan = (r: Pick<RiderProps, "raceStatus" | "timeStartRace">) => !!r.timeStartRace || (r.raceStatus != null && r.raceStatus !== "upcoming");

/** True when this rider's wave has had its GO (a running category, or a finished one that actually ran). */
export function riderStartedLocally(rider: RiderProps, categories: CategoryProps[], riders: RiderProps[]): boolean {
  if (riderRan(rider)) return true;
  const cat = categories.find((c) => c.raceUuid === rider.raceUuid && sameCategory(rider, c));
  if (!cat) return false;
  if (cat.status === "running") return true;
  return cat.status === "finished" && riders.some((r) => r.raceUuid === rider.raceUuid && sameCategory(r, cat) && riderRan(r));
}

/** The editors' rule: a SHARED race's started rider can't be edited or deleted normally. */
export const riderLockedAfterGo = (rider: RiderProps, categories: CategoryProps[], riders: RiderProps[]): boolean =>
  isLiveRace(rider.raceUuid) && riderStartedLocally(rider, categories, riders);

export const LOCKED_AFTER_GO_TEXT = "Locked after the wave's GO. Fix a name in Results → rider → Correct name.";
