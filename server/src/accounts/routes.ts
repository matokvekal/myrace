/**
 * Accounts & organizations (0.2 Phase 2, P2-T2).
 *
 *  - GET  /accounts                         my personal account + organizations I belong to
 *                                           (+ my own pending organization requests)
 *  - POST /organizations                    request an organization: created 'pending',
 *                                           requestedBy = me, NO rights for anyone. Activation
 *                                           and the first owner/admin are granted in the DB.
 *  - GET/PATCH /organizations/:accountId    profile (active members; requester only while pending
 *                                           and without a member row) · edit (owner, admin)
 *  - GET /organizations/:accountId/members  owner, admin, manager (emails: owner/admin only)
 *  - …/invitations (P2-T3, invitations.ts) · GET …/races (P2-T4, staff; projection only)
 *  - PATCH/DELETE …/members/:userId         owner, admin; only manager|judge|member rows —
 *                                           owner/admin rows change in the DB only.
 *
 * Orgs are isolated: an account the caller can't see answers 404 (no existence leak).
 * A pending or suspended org refuses every write (403 organization_inactive).
 * Organization membership grants no race access. Every change is in audit_logs (same tx).
 */
import { Router } from "express";
import { z } from "zod";
import { authed, requireAuth } from "../auth/auth.js";
import { db, type Db, tx } from "../db/pool.js";
import { ApiError, route } from "../lib/core.js";
import { ensurePersonalAccount, logAudit, type OrgRole } from "./accounts.js";
import { orgInvitationsRouter } from "./invitations.js";
import { isUuid, ORG_COLUMNS, requireOrgRole, visibleOrg, type OrgRow } from "./orgAccess.js";

/** A user may have at most this many organization requests waiting for activation. */
export const MAX_PENDING_ORG_REQUESTS = 5;

const STAFF_ROLES: OrgRole[] = ["owner", "admin"];
const MEMBER_VIEW_ROLES: OrgRole[] = ["owner", "admin", "manager"];
/** Roles the API may assign; owner/admin are granted in the database only. */
const ASSIGNABLE_ROLES = ["manager", "judge", "member"] as const;

const publicOrg = ({ requestedBy: _r, ...o }: OrgRow) => o;

// --- /accounts ---------------------------------------------------------------

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

accountsRouter.get("/", route(async (req, res) => {
  const userId = authed(req).userId;
  const personalId = await ensurePersonalAccount(db, userId);
  // The personal account's name is the user's name, read live (users.name can change).
  const personal = await db.one(
    `SELECT ${ORG_COLUMNS.replace("a.name", "COALESCE(u.name, a.name) AS name")}
     FROM accounts a LEFT JOIN users u ON u.id = a."personalUserId" WHERE a.id = $1`,
    [personalId],
  );
  const organizations = await db.query(
    `SELECT ${ORG_COLUMNS}, m.role AS "myRole", m.status AS "myStatus"
     FROM account_members m JOIN accounts a ON a.id = m."accountId"
     WHERE m."userId" = $1 AND m.status <> 'removed' AND a.type = 'organization'
     ORDER BY a.name, a."createdAt"`,
    [userId],
  );
  // My organization requests still pending, where I have no membership row at all (same rule
  // as the requester's view in orgAccess.visibleOrg): the "pending" notice in the app.
  const requests = await db.query(
    `SELECT ${ORG_COLUMNS} FROM accounts a
     WHERE a.type = 'organization' AND a.status = 'pending' AND a."requestedBy" = $1
       AND NOT EXISTS (SELECT 1 FROM account_members m WHERE m."accountId" = a.id AND m."userId" = $1)
     ORDER BY a."createdAt" DESC`,
    [userId],
  );
  res.json({ personal, organizations, requests });
}));

// --- /organizations ----------------------------------------------------------

export const organizationsRouter = Router();
organizationsRouter.use(requireAuth);

const orgName = z.string().trim().min(2).max(80);
const orgText = z.string().trim().max(2000);
const createBody = z.object({
  name: orgName,
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,40}$/, "slug: 3–40 lowercase letters, digits or '-'").optional(),
  description: orgText.optional(),
}).strict();

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "23505";

organizationsRouter.post("/", route(async (req, res) => {
  const body = createBody.parse(req.body);
  const userId = authed(req).userId;
  const org = await tx(async (d) => {
    // Serialize one user's requests on their personal account row (the pending limit).
    const personalId = await ensurePersonalAccount(d, userId);
    await d.one(`SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, [personalId]);
    const pending = await d.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM accounts WHERE type = 'organization' AND status = 'pending' AND "requestedBy" = $1`,
      [userId],
    );
    if (pending!.n >= MAX_PENDING_ORG_REQUESTS) {
      throw new ApiError(409, "too_many_requests", `At most ${MAX_PENDING_ORG_REQUESTS} organization requests can wait for approval`);
    }
    if (body.slug && (await d.one(`SELECT 1 FROM accounts WHERE slug = $1`, [body.slug]))) {
      throw new ApiError(409, "slug_taken", "This address is already taken");
    }
    // No account_members row: requesting an organization grants no rights (Guidelines §5).
    const row = await d.one<OrgRow>(
      `INSERT INTO accounts (type, name, slug, status, "requestedBy", description)
       VALUES ('organization', $1, $2, 'pending', $3, $4)
       RETURNING id, type, name, slug, status, description, contact, "requestedBy", "createdAt", "updatedAt"`,
      [body.name, body.slug ?? null, userId, body.description ?? ""],
    );
    await logAudit(d, {
      accountId: row!.id, actorUserId: userId, action: "organization.requested", entityType: "organization", entityId: row!.id,
      data: { name: row!.name, slug: row!.slug },
    });
    return row!;
  }).catch((e) => {
    if (isUniqueViolation(e)) throw new ApiError(409, "slug_taken", "This address is already taken");
    throw e;
  });
  res.status(201).json({ organization: publicOrg(org) });
}));

organizationsRouter.get("/:accountId", route(async (req, res) => {
  const v = await visibleOrg(db, req);
  res.json({ organization: publicOrg(v.org), myRole: v.myRole, myStatus: v.myStatus, requestedByMe: v.org.requestedBy === v.userId });
}));

const patchBody = z.object({ name: orgName.optional(), description: orgText.optional(), contact: z.string().trim().max(500).optional() }).strict();

organizationsRouter.patch("/:accountId", route(async (req, res) => {
  const body = patchBody.parse(req.body);
  const org = await tx(async (d) => {
    const v = await requireOrgRole(d, req, STAFF_ROLES, true);
    const changed = (Object.keys(body) as (keyof typeof body)[]).filter((k) => body[k] !== undefined && body[k] !== v.org[k]);
    if (changed.length === 0) return v.org;
    const row = await d.one<OrgRow>(
      `UPDATE accounts SET name = COALESCE($2, name), description = COALESCE($3, description), contact = COALESCE($4, contact), "updatedAt" = now()
       WHERE id = $1 RETURNING id, type, name, slug, status, description, contact, "requestedBy", "createdAt", "updatedAt"`,
      [v.org.id, body.name ?? null, body.description ?? null, body.contact ?? null],
    );
    await logAudit(d, {
      accountId: v.org.id, actorUserId: v.userId, action: "organization.updated", entityType: "organization", entityId: v.org.id,
      // Field names always; values only for name/description — never for contact (personal data).
      data: { fields: changed, ...Object.fromEntries(changed.filter((k) => k !== "contact").map((k) => [k, { from: v.org[k], to: body[k] }])) },
    });
    return row!;
  });
  res.json({ organization: publicOrg(org) });
}));

organizationsRouter.get("/:accountId/members", route(async (req, res) => {
  const v = await requireOrgRole(db, req, MEMBER_VIEW_ROLES);
  const rows = await db.query<{ email: string | null }>(
    `SELECT m."userId", u.name, u.email, m.role, m.status, m."createdAt", m."updatedAt"
     FROM account_members m LEFT JOIN users u ON u.id = m."userId"
     WHERE m."accountId" = $1 AND m.status <> 'removed'
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 WHEN 'judge' THEN 3 ELSE 4 END, m."createdAt"`,
    [v.org.id],
  );
  // Emails for owner/admin only; a manager sees name, role and status.
  const withEmail = STAFF_ROLES.includes(v.myRole);
  res.json({ members: rows.map(({ email, ...m }) => (withEmail ? { ...m, email } : m)) });
}));

/** The target member row (not removed) of an org the caller administers; 404 if none. */
async function targetMember(d: Db, accountId: string, rawUserId: unknown) {
  if (!isUuid(rawUserId)) throw new ApiError(404, "not_found", "No such member");
  const row = await d.one<{ userId: string; role: OrgRole; status: string }>(
    `SELECT "userId", role, status FROM account_members WHERE "accountId" = $1 AND "userId" = $2 AND status <> 'removed' FOR UPDATE`,
    [accountId, rawUserId],
  );
  if (!row) throw new ApiError(404, "not_found", "No such member");
  return row;
}

const roleBody = z.object({ role: z.enum(ASSIGNABLE_ROLES) }).strict();

organizationsRouter.patch("/:accountId/members/:userId", route(async (req, res) => {
  const body = roleBody.parse(req.body);
  await tx(async (d) => {
    const v = await requireOrgRole(d, req, STAFF_ROLES, true);
    const t = await targetMember(d, v.org.id, req.params.userId);
    if (t.role === "owner" || t.role === "admin") {
      throw new ApiError(403, "owner_only", "Owner and admin roles are changed only by the platform");
    }
    if (t.role === body.role) return;
    await d.query(
      `UPDATE account_members SET role = $3, "updatedAt" = now() WHERE "accountId" = $1 AND "userId" = $2`,
      [v.org.id, t.userId, body.role],
    );
    await logAudit(d, {
      accountId: v.org.id, actorUserId: v.userId, action: "organization.member_role_changed", entityType: "account_member", entityId: t.userId,
      data: { userId: t.userId, from: t.role, to: body.role },
    });
  });
  res.json({ ok: true });
}));

organizationsRouter.delete("/:accountId/members/:userId", route(async (req, res) => {
  await tx(async (d) => {
    const v = await requireOrgRole(d, req, STAFF_ROLES, true);
    const t = await targetMember(d, v.org.id, req.params.userId);
    if (t.role === "owner") throw new ApiError(403, "owner_protected", "The organization owner cannot be removed");
    if (t.role === "admin") throw new ApiError(403, "owner_only", "Admins are removed only by the platform");
    await d.query(
      `UPDATE account_members SET status = 'removed', "updatedAt" = now() WHERE "accountId" = $1 AND "userId" = $2`,
      [v.org.id, t.userId],
    );
    await logAudit(d, {
      accountId: v.org.id, actorUserId: v.userId, action: "organization.member_removed", entityType: "account_member", entityId: t.userId,
      data: { userId: t.userId, role: t.role },
    });
  });
  res.status(204).end();
}));

// --- judge pool invitations (P2-T3) -------------------------------------------
organizationsRouter.use("/:accountId/invitations", orgInvitationsRouter);

// --- organization races (P2-T4) ------------------------------------------------

/**
 * GET /organizations/:accountId/races — the org's races for its staff (owner|admin|manager):
 * a projection only (no race data, no riders). It grants no race access — opening a race
 * still needs race_members or ownership.
 */
organizationsRouter.get("/:accountId/races", route(async (req, res) => {
  const v = await requireOrgRole(db, req, MEMBER_VIEW_ROLES);
  const races = await db.query(
    `SELECT r.uuid, r.name, r.date, r.status, u.name AS "ownerName", r."createdAt"
     FROM races r LEFT JOIN users u ON u.id = r."ownerUserId"
     WHERE r."accountId" = $1 AND r."deletedAt" IS NULL
     ORDER BY r."createdAt" DESC`,
    [v.org.id],
  );
  res.json({ races });
}));
