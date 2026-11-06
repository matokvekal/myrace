/**
 * Accounts (0.2 Phase 2, migration 012): every user has exactly one personal account;
 * organizations are accounts of type 'organization'. Organization membership grants NO
 * race access — race access still comes only from race_members + the race owner.
 *
 * Non-race audit entries go to audit_logs (logAudit), written in the caller's transaction.
 */
import type { Db } from "../db/pool.js";
import { ApiError } from "../lib/core.js";

export type AccountType = "personal" | "organization";
export type AccountStatus = "pending" | "active" | "suspended";
export type OrgRole = "owner" | "admin" | "manager" | "judge" | "member";
export type OrgMemberStatus = "invited" | "active" | "suspended" | "removed";

/**
 * The user's personal account id, created on first need. Idempotent and race-safe:
 * concurrent callers all get the same row (UNIQUE "personalUserId" + ON CONFLICT).
 */
export async function ensurePersonalAccount(d: Db, userId: string): Promise<string> {
  const existing = await d.one<{ id: string }>(`SELECT id FROM accounts WHERE "personalUserId" = $1`, [userId]);
  if (existing) return existing.id;
  const created = await d.one<{ id: string }>(
    `INSERT INTO accounts (type, name, status, "personalUserId")
     VALUES ('personal', COALESCE((SELECT name FROM users WHERE id = $1), ''), 'active', $1)
     ON CONFLICT ("personalUserId") DO NOTHING
     RETURNING id`,
    [userId],
  );
  if (created) return created.id;
  // Another transaction created it meanwhile (ON CONFLICT waited for its commit).
  const row = await d.one<{ id: string }>(`SELECT id FROM accounts WHERE "personalUserId" = $1`, [userId]);
  if (!row) throw new Error("personal account missing after insert");
  return row.id;
}

export interface OrgRoleInfo {
  role: OrgRole;
  status: OrgMemberStatus;
  accountStatus: AccountStatus;
}

/** The user's membership in an organization, or null (no row, or not an organization). */
export async function orgRole(d: Db, accountId: string, userId: string): Promise<OrgRoleInfo | null> {
  return d.one<OrgRoleInfo>(
    `SELECT m.role, m.status, a.status AS "accountStatus"
     FROM account_members m JOIN accounts a ON a.id = m."accountId"
     WHERE m."accountId" = $1 AND m."userId" = $2 AND a.type = 'organization'`,
    [accountId, userId],
  );
}

export interface AuditEntry {
  accountId?: string | null;
  raceUuid?: string | null;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Never tokens, link secrets, join codes or passwords. */
  data?: Record<string, unknown>;
}

/** Appends one audit_logs row. Call inside the same transaction as the change it records. */
export async function logAudit(d: Db, e: AuditEntry): Promise<void> {
  await d.query(
    `INSERT INTO audit_logs ("accountId", "raceUuid", "actorUserId", action, "entityType", "entityId", data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [e.accountId ?? null, e.raceUuid ?? null, e.actorUserId, e.action, e.entityType, e.entityId ?? null, JSON.stringify(e.data ?? {})],
  );
}

/** Higher = more rights. An invitation never lowers a member's role (see account invitations). */
export const ORG_ROLE_RANK: Record<OrgRole, number> = { owner: 5, admin: 4, manager: 3, judge: 2, member: 1 };

/** Org roles that may create races for the organization (P2-T4). */
export const ORG_RACE_CREATOR_ROLES: OrgRole[] = ["owner", "admin", "manager"];

/**
 * The account a new race goes to. No `requested` → the caller's personal account. Otherwise it
 * must be the caller's personal account, or an ACTIVE organization where the caller is an
 * active owner|admin|manager (else 403 not_org_staff). The membership is checked first; only
 * then is the account row share-locked (and its status re-read) for the rest of the transaction.
 */
export async function raceAccountFor(d: Db, userId: string, requested?: string): Promise<{ accountId: string; organization: boolean }> {
  const personal = await ensurePersonalAccount(d, userId);
  if (!requested || requested === personal) return { accountId: personal, organization: false };
  const refuse = () => new ApiError(403, "not_org_staff", "You can't create races for this account");
  const mine = await orgRole(d, requested, userId);
  if (!mine || mine.status !== "active" || mine.accountStatus !== "active" || !ORG_RACE_CREATOR_ROLES.includes(mine.role)) throw refuse();
  const acc = await d.one<{ status: AccountStatus }>(`SELECT status FROM accounts WHERE id = $1 AND type = 'organization' FOR SHARE`, [requested]);
  if (acc?.status !== "active") throw refuse();
  return { accountId: requested, organization: true };
}
