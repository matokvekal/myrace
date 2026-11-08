/**
 * 0.3.5 — official podium approval per category (category_approvals, migration 013).
 *
 *  - A judge allowed to approve (shared `canApproveCategory`: live.update or results.update,
 *    category in scope; members' writes on) types APPROVED; the server checks the word itself,
 *    that the category finished, and stores who / when / a hash of the category's result.
 *  - The approval holds only while the result is unchanged: `invalidateChangedApprovals` runs
 *    in the SAME transaction as every result-changing path (Actions, finalize, amend) and marks
 *    a changed category 'invalidated' with a RaceAdmin audit entry; every read re-checks the
 *    hash too, so no path can leave a stale approval on screen.
 *  - Guests see only valid approvals, without judge identity.
 */
import { createHash } from "node:crypto";
import type { Db } from "../db/pool.js";
import { approvalBlocker, categoryResultFingerprint, type CategoryApprovalView } from "../../../src/shared/race/approval.js";
import type { RaceState } from "../../../src/shared/race/state.js";
import { logServerEvent } from "./audit.js";

interface ApprovalRow {
  categoryUuid: string;
  status: "approved" | "invalidated";
  resultDigest: string;
  approvedAt: Date;
  approvedByName: string | null;
  invalidatedAt: Date | null;
  invalidatedReason: string | null;
}

export const resultDigest = (state: RaceState, categoryUuid: string): string | null => {
  const f = categoryResultFingerprint(state, categoryUuid);
  return f === null ? null : createHash("sha256").update(f).digest("hex");
};

async function rows(d: Db, raceUuid: string, lock = false): Promise<ApprovalRow[]> {
  return d.query<ApprovalRow>(
    `SELECT a."categoryUuid", a.status, a."resultDigest", a."approvedAt", u.name AS "approvedByName", a."invalidatedAt", a."invalidatedReason"
     FROM category_approvals a LEFT JOIN users u ON u.id = a."approvedBy"
     WHERE a."raceUuid" = $1 ${lock ? "FOR UPDATE OF a" : ""}`,
    [raceUuid],
  );
}

/** Current approvals, each re-checked against the result as it is now. */
export async function approvalViews(d: Db, state: RaceState, opts: { guest?: boolean } = {}): Promise<CategoryApprovalView[]> {
  const out: CategoryApprovalView[] = [];
  for (const r of await rows(d, state.race.uuid)) {
    const cat = state.categories[r.categoryUuid];
    if (!cat || cat.ignored) continue;
    const valid = r.status === "approved" && resultDigest(state, r.categoryUuid) === r.resultDigest;
    if (opts.guest) {
      if (valid) out.push({ categoryUuid: r.categoryUuid, status: "approved", approvedAt: new Date(r.approvedAt).toISOString() });
      continue;
    }
    out.push({
      categoryUuid: r.categoryUuid,
      status: valid ? "approved" : "invalidated",
      approvedAt: new Date(r.approvedAt).toISOString(),
      approvedByName: r.approvedByName,
      invalidatedAt: valid ? null : r.invalidatedAt ? new Date(r.invalidatedAt).toISOString() : null,
      invalidatedReason: valid ? null : r.invalidatedReason ?? "Results changed after approval",
    });
  }
  return out;
}

/**
 * Inside the transaction that changed results (race row locked): every approval whose result
 * no longer matches becomes 'invalidated' + a RaceAdmin audit entry. Returns the last seq written (0 = none).
 */
export async function invalidateChangedApprovals(d: Db, state: RaceState, actorId: string, cause: string): Promise<number> {
  let seq = 0;
  for (const r of await rows(d, state.race.uuid, true)) {
    if (r.status !== "approved") continue;
    if (resultDigest(state, r.categoryUuid) === r.resultDigest) continue;
    const reason = `Results changed after approval (${cause})`.slice(0, 300);
    await d.query(
      `UPDATE category_approvals SET status = 'invalidated', "invalidatedAt" = now(), "invalidatedBy" = $3, "invalidatedReason" = $4
       WHERE "raceUuid" = $1 AND "categoryUuid" = $2`,
      [state.race.uuid, r.categoryUuid, actorId, reason],
    );
    seq = await logServerEvent(d, state.race.uuid, actorId, "RaceAdmin", {
      op: "approvalInvalidated", categoryUuid: r.categoryUuid, categoryName: state.categories[r.categoryUuid]?.name ?? "", cause: cause.slice(0, 200),
    });
  }
  return seq;
}

/** Stores the approval (caller checked membership + permission, holds the race row lock). Returns the audit seq. */
export async function storeApproval(d: Db, state: RaceState, categoryUuid: string, userId: string): Promise<number> {
  const blocker = approvalBlocker(state, categoryUuid);
  if (blocker) throw Object.assign(new Error(blocker), { blocker });
  const digest = resultDigest(state, categoryUuid)!;
  const seq = await logServerEvent(d, state.race.uuid, userId, "RaceAdmin", {
    op: "categoryApproved", categoryUuid, categoryName: state.categories[categoryUuid].name,
  });
  await d.query(
    `INSERT INTO category_approvals ("raceUuid", "categoryUuid", status, "resultDigest", "approvedBy", "approvedAt", "approvedSeq")
     VALUES ($1, $2, 'approved', $3, $4, now(), $5)
     ON CONFLICT ("raceUuid", "categoryUuid") DO UPDATE SET
       status = 'approved', "resultDigest" = EXCLUDED."resultDigest", "approvedBy" = EXCLUDED."approvedBy",
       "approvedAt" = now(), "approvedSeq" = EXCLUDED."approvedSeq",
       "invalidatedAt" = NULL, "invalidatedBy" = NULL, "invalidatedReason" = NULL`,
    [state.race.uuid, categoryUuid, digest, userId, seq],
  );
  return seq;
}
