/**
 * 0.3.5 — official podium approval per category. Pure (server + app).
 *
 * An approval is tied to the category's results EXACTLY as they were when the judge typed
 * APPROVED: the server stores a hash of `categoryResultFingerprint` and treats the approval
 * as invalid the moment the fingerprint changes (a lap, an Undo, a correction, a status, a
 * name or bib fix, a rider added/removed, the category's laps…) — whatever path changed it.
 */
import { categoryKey } from "./engine";
import type { CategoryUuid, RaceState } from "./state";

export const APPROVAL_CONFIRM_WORD = "APPROVED";

export type ApprovalStatus = "approved" | "invalidated";

/** What members and guests receive about a category's approval. Guests get no judge identity. */
export interface CategoryApprovalView {
  categoryUuid: CategoryUuid;
  status: ApprovalStatus;
  approvedAt: string;
  approvedByName?: string | null;
  invalidatedAt?: string | null;
  invalidatedReason?: string | null;
}

/** Canonical text of everything that makes up a category's published result. null = no such category. */
export function categoryResultFingerprint(state: RaceState, categoryUuid: CategoryUuid): string | null {
  const c = state.categories[categoryUuid];
  if (!c) return null;
  const key = categoryKey(c.name, c.subCategory);
  const riders = Object.values(state.riders)
    .filter((r) => categoryKey(r.category, r.subCategory) === key)
    .sort((a, b) => (a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0))
    .map((r) => [
      r.uuid, r.bibNumber ?? null, r.firstName ?? "", r.middleName ?? "", r.lastName ?? "", r.team ?? "",
      r.status, r.raceStatus, r.lapsCounter ?? 0, r.elapsedTimeFromStart ?? null, r.position_category ?? null,
      (r.lapsDetails ?? []).map((l) => [l.lap, l.endTime ?? null]),
    ]);
  return JSON.stringify({ c: [c.uuid, c.name, c.subCategory ?? null, c.laps ?? null, c.ignored ?? false], riders });
}

/** Approve only a finished category that really ran (not one closed as "not started"). */
export function approvalBlocker(state: RaceState, categoryUuid: CategoryUuid): string | null {
  const c = state.categories[categoryUuid];
  if (!c || c.ignored) return "Category not found";
  if (c.status !== "finished" || c.startedAt == null) return "Only a finished category can be approved";
  return null;
}
