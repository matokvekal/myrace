/**
 * Who may see / act on an organization (0.2 Phase 2). Shared by the organization routes and
 * the organization invitation routes.
 *
 *  - Visible to: an ACTIVE member (any role), or — only while the org is still 'pending' —
 *    the user who requested it, as long as they have no account_members row at all (a
 *    requester who later became a member and was removed/suspended loses the requester view).
 *  - Anyone else: 404 (no existence leak, malformed ids included).
 *  - Authorization always runs first, WITHOUT locks; only then may a route take the org row
 *    lock (`requireOrgRole(..., lock = true)` re-reads and re-checks under FOR UPDATE).
 */
import type { Request } from "express";
import { z } from "zod";
import { authed } from "../auth/auth.js";
import type { Db } from "../db/pool.js";
import { ApiError } from "../lib/core.js";
import { orgRole, type AccountStatus, type OrgMemberStatus, type OrgRole } from "./accounts.js";

export const orgNotFound = () => new ApiError(404, "not_found", "No such organization");
export const orgInactive = () => new ApiError(403, "organization_inactive", "This organization is not active");

export const ORG_COLUMNS = `a.id, a.type, a.name, a.slug, a.status, a.description, a.contact, a."createdAt", a."updatedAt"`;

export interface OrgRow {
  id: string;
  type: "organization";
  name: string;
  slug: string | null;
  status: AccountStatus;
  description: string;
  contact: string;
  requestedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VisibleOrg {
  org: OrgRow;
  userId: string;
  myRole: OrgRole | null;
  myStatus: OrgMemberStatus | null;
}

const uuid = z.string().uuid();
export const isUuid = (v: unknown): v is string => uuid.safeParse(v).success;

async function loadVisible(d: Db, accountId: string, userId: string, lock: boolean): Promise<VisibleOrg | null> {
  const org = await d.one<OrgRow>(
    `SELECT ${ORG_COLUMNS}, a."requestedBy" FROM accounts a WHERE a.id = $1 AND a.type = 'organization'${lock ? " FOR UPDATE" : ""}`,
    [accountId],
  );
  if (!org) return null;
  const mine = await orgRole(d, accountId, userId);
  const activeMember = mine?.status === "active";
  const requester = !mine && org.status === "pending" && org.requestedBy === userId;
  if (!activeMember && !requester) return null;
  return { org, userId, myRole: activeMember ? mine!.role : null, myStatus: mine?.status ?? null };
}

/** The organization in `req.params.accountId`, if the caller may see it; else 404. Never locks. */
export async function visibleOrg(d: Db, req: Request): Promise<VisibleOrg> {
  const accountId = req.params.accountId;
  if (!isUuid(accountId)) throw orgNotFound();
  const v = await loadVisible(d, accountId, authed(req).userId, false);
  if (!v) throw orgNotFound();
  return v;
}

function checkRole(v: VisibleOrg, roles: OrgRole[]) {
  if (v.org.status !== "active") throw orgInactive();
  if (!v.myRole || !roles.includes(v.myRole)) throw new ApiError(403, "forbidden", "Not allowed in this organization");
}

/**
 * visibleOrg + the org must be active and my (active) role one of `roles`. With `lock`, the
 * org row is locked AFTER that check, then everything is re-checked under the lock (the
 * status or my role may have changed meanwhile).
 */
export async function requireOrgRole(d: Db, req: Request, roles: OrgRole[], lock = false): Promise<VisibleOrg & { myRole: OrgRole }> {
  let v = await visibleOrg(d, req);
  checkRole(v, roles);
  if (lock) {
    const again = await loadVisible(d, v.org.id, v.userId, true);
    if (!again) throw orgNotFound();
    checkRole(again, roles);
    v = again;
  }
  return v as VisibleOrg & { myRole: OrgRole };
}
