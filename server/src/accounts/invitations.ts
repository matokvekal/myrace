/**
 * Organization (judge pool) invitations (0.2 Phase 2, P2-T3). Table account_invitations
 * mirrors race `invitations`: only a hash of the link secret is stored, one-time (or maxUses
 * for an open link), expiry, revoke, decline.
 *
 * Organizer side (mounted under /organizations/:accountId/invitations):
 *  - POST   /          owner|admin any of manager|judge|member; manager → judge only
 *  - GET    /          owner|admin
 *  - DELETE /:invId    owner|admin (revoke)
 * Invitee side:
 *  - GET  /account-invitations/:token           preview (org name, role, status, canAccept)
 *  - POST /account-invitations/:token/accept
 *  - GET  /me/account-invitations               valid ones addressed to me
 *  - POST /me/account-invitations/:id/accept | /:id/decline
 *
 * Accepting makes the user an active member with the invitation's role, but never lowers an
 * existing role (an owner/admin/manager stays what they are). A suspended member can't
 * reactivate through an invitation; a removed member only through one created after the removal.
 * Joining the pool grants NO race access. Every change is in audit_logs (no secrets).
 */
import { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { authed, requireAuth } from "../auth/auth.js";
import { env } from "../config/env.js";
import { db, type Db, tx } from "../db/pool.js";
import { ApiError, normalizeEmail, randomToken, route, sha256 } from "../lib/core.js";
import { sendMail } from "../lib/messaging.js";
import { logAudit, ORG_ROLE_RANK, type AccountStatus, type OrgMemberStatus, type OrgRole } from "./accounts.js";
import { isUuid, requireOrgRole } from "./orgAccess.js";

const ASSIGNABLE_ROLES = ["manager", "judge", "member"] as const;
const MANAGE_ROLES: OrgRole[] = ["owner", "admin"];
const INVITER_ROLES: OrgRole[] = ["owner", "admin", "manager"];

const orgInviteUrl = (secret: string) => `${env.APP_URL.replace(/\/$/, "")}/org-invite/${secret}`;

const inviteBody = z.object({
  emails: z.array(z.string().email()).max(200).default([]),
  userIds: z.array(z.string().uuid()).max(200).default([]),
  /** An open link/QR anyone signed in can use (up to maxUses times). */
  link: z.boolean().default(false),
  maxUses: z.number().int().min(1).max(500).default(1),
  role: z.enum(ASSIGNABLE_ROLES).default("judge"),
  expiresInDays: z.number().int().min(1).max(90).default(14),
  sendEmail: z.boolean().default(true),
  message: z.string().max(500).optional(),
}).strict();

interface InvRow {
  id: string;
  accountId: string;
  email: string | null;
  userId: string | null;
  role: OrgRole;
  maxUses: number;
  useCount: number;
  createdAt: Date;
  expiresAt: Date;
  sentAt: Date | null;
  revokedAt: Date | null;
  declinedAt: Date | null;
  createdBy: string;
  orgName: string;
  orgStatus: AccountStatus;
  invitedBy: string | null;
}

const invStatus = (i: Pick<InvRow, "declinedAt" | "revokedAt" | "expiresAt" | "useCount" | "maxUses">) =>
  i.declinedAt ? "declined" : i.revokedAt ? "revoked" : new Date(i.expiresAt) < new Date() ? "expired" : i.useCount >= i.maxUses ? "used" : "valid";

const SELECT_INV = `SELECT i.id, i."accountId", i.email, i."userId", i.role, i."maxUses", i."useCount", i."createdAt", i."expiresAt",
         i."sentAt", i."revokedAt", i."declinedAt", i."createdBy", a.name AS "orgName", a.status AS "orgStatus", u.name AS "invitedBy"
  FROM account_invitations i JOIN accounts a ON a.id = i."accountId" AND a.type = 'organization' LEFT JOIN users u ON u.id = i."createdBy"`;

// --- organizer side ------------------------------------------------------------

export const orgInvitationsRouter = Router({ mergeParams: true });

orgInvitationsRouter.post("/", route(async (req, res) => {
  const body = inviteBody.parse(req.body);
  const targets = new Map<string, { email: string | null; userId: string | null }>();
  for (const e of body.emails) targets.set(`e:${normalizeEmail(e)}`, { email: normalizeEmail(e), userId: null });
  for (const u of body.userIds) targets.set(`u:${u}`, { email: null, userId: u });
  if (body.link) targets.set("link", { email: null, userId: null });
  if (targets.size === 0) throw new ApiError(400, "invalid", "Choose who to invite, or create a link");
  const expiresAt = new Date(Date.now() + body.expiresInDays * 86_400_000);

  const { rows, orgName, inviter } = await tx(async (d) => {
    // Authorization first (no lock), then the org row lock + re-check (status may change).
    const v = await requireOrgRole(d, req, INVITER_ROLES, true);
    if (v.myRole === "manager" && body.role !== "judge") throw new ApiError(403, "forbidden", "Managers may invite judges only");
    const out: { id: string; secret: string; link: boolean; email: string | null; userId: string | null }[] = [];
    for (const [key, t] of targets) {
      if (t.userId && !(await d.one(`SELECT 1 FROM users WHERE id = $1`, [t.userId]))) continue;
      const secret = randomToken(24);
      const link = key === "link";
      const row = await d.one<{ id: string }>(
        `INSERT INTO account_invitations ("accountId", email, "userId", "tokenHash", role, "maxUses", "createdBy", "expiresAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [v.org.id, t.email, t.userId, sha256(secret), body.role, link ? body.maxUses : 1, v.userId, expiresAt],
      );
      out.push({ id: row!.id, secret, link, ...t });
      await logAudit(d, {
        accountId: v.org.id, actorUserId: v.userId, action: "organization.invitation_created", entityType: "account_invitation", entityId: row!.id,
        data: { invitationId: row!.id, email: t.email, userId: t.userId, link, role: body.role, maxUses: link ? body.maxUses : 1, expiresAt: expiresAt.toISOString() },
      });
    }
    const me = await d.one<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [v.userId]);
    return { rows: out, orgName: v.org.name, inviter: me?.name ?? "" };
  });

  const created = [];
  for (const r of rows) {
    const url = orgInviteUrl(r.secret);
    let emailTo = r.email;
    if (!emailTo && r.userId) emailTo = (await db.one<{ email: string | null }>(`SELECT email FROM users WHERE id = $1`, [r.userId]))?.email ?? null;
    if (body.sendEmail && emailTo) {
      await sendMail(
        emailTo,
        `${inviter} invites you to ${orgName}`,
        `${inviter} invited you to join "${orgName}" on Commissaire as ${body.role}.${body.message ? `\n\n${body.message}` : ""}\n\nOpen this link, sign in, and accept:\n${url}\n\nThe invitation expires on ${expiresAt.toDateString()}.`,
      );
      await db.query(`UPDATE account_invitations SET "sentAt" = now() WHERE id = $1`, [r.id]);
    }
    created.push({ id: r.id, email: r.email, userId: r.userId, link: r.link, role: body.role, url, qrSvg: await QRCode.toString(url, { type: "svg", margin: 1 }) });
  }
  res.status(201).json({ invitations: created });
}));

orgInvitationsRouter.get("/", route(async (req, res) => {
  const v = await requireOrgRole(db, req, MANAGE_ROLES);
  const rows = await db.query<InvRow & { userName: string | null }>(
    `SELECT i.id, i.email, i."userId", u.name AS "userName", i.role, i."maxUses", i."useCount", i."createdAt", i."expiresAt",
            i."sentAt", i."revokedAt", i."declinedAt", i."createdBy"
     FROM account_invitations i LEFT JOIN users u ON u.id = i."userId"
     WHERE i."accountId" = $1 ORDER BY i."createdAt" DESC`,
    [v.org.id],
  );
  res.json({ invitations: rows.map((i) => ({ ...i, link: !i.email && !i.userId, status: invStatus(i) })) });
}));

orgInvitationsRouter.delete("/:invId", route(async (req, res) => {
  await tx(async (d) => {
    const v = await requireOrgRole(d, req, MANAGE_ROLES, true);
    const invId = req.params.invId;
    if (!isUuid(invId)) throw new ApiError(404, "not_found", "No such invitation");
    const inv = await d.one<{ revokedAt: Date | null }>(
      `SELECT "revokedAt" FROM account_invitations WHERE id = $1 AND "accountId" = $2 FOR UPDATE`, [invId, v.org.id]);
    if (!inv) throw new ApiError(404, "not_found", "No such invitation");
    if (inv.revokedAt) return;
    await d.query(`UPDATE account_invitations SET "revokedAt" = now() WHERE id = $1`, [invId]);
    await logAudit(d, {
      accountId: v.org.id, actorUserId: v.userId, action: "organization.invitation_revoked", entityType: "account_invitation", entityId: invId,
      data: { invitationId: invId },
    });
  });
  res.status(204).end();
}));

// --- invitee side --------------------------------------------------------------

/** Is this invitation for this user? Email invitations need that email verified on the account. */
async function addressedTo(d: Db, i: InvRow, userId: string): Promise<boolean> {
  if (i.userId) return i.userId === userId;
  if (i.email) return !!(await d.one(`SELECT 1 FROM user_identities WHERE "userId" = $1 AND email = $2 AND "emailVerified"`, [userId, i.email]));
  return true; // open link
}

interface MemberRow { role: OrgRole; status: OrgMemberStatus; updatedAt: Date }

/** Why this user's existing membership blocks accepting, or null. */
function membershipBlock(cur: MemberRow | null, i: InvRow): ApiError | null {
  if (cur?.status === "suspended") return new ApiError(403, "member_suspended", "Your membership in this organization is suspended");
  // A removed member comes back only through an invitation made after the removal.
  if (cur?.status === "removed" && new Date(cur.updatedAt) >= new Date(i.createdAt)) {
    return new ApiError(410, "invitation_unavailable", "This invitation is no longer valid");
  }
  return null;
}

const memberOf = (d: Db, accountId: string, userId: string, lock = false) =>
  d.one<MemberRow>(
    `SELECT role, status, "updatedAt" FROM account_members WHERE "accountId" = $1 AND "userId" = $2${lock ? " FOR UPDATE" : ""}`,
    [accountId, userId],
  );

async function accept(i: InvRow, userId: string) {
  // Authorization first (no locks).
  if (!(await addressedTo(db, i, userId))) {
    throw new ApiError(403, "wrong_account", i.email ? `This invitation is for ${i.email}. Sign in with that email (verified) to accept.` : "This invitation is for another account");
  }
  return tx(async (d) => {
    const locked = await d.one<InvRow>(`${SELECT_INV} WHERE i.id = $1 FOR UPDATE OF i`, [i.id]);
    if (!locked || invStatus(locked) !== "valid") throw new ApiError(410, "invitation_unavailable", "This invitation is no longer valid");
    const org = await d.one<{ status: AccountStatus }>(`SELECT status FROM accounts WHERE id = $1 AND type = 'organization' FOR SHARE`, [locked.accountId]);
    if (org?.status !== "active") throw new ApiError(403, "organization_inactive", "This organization is not active");
    const cur = await memberOf(d, locked.accountId, userId, true);
    const block = membershipBlock(cur, locked);
    if (block) throw block;
    const previousRole = cur && cur.status !== "removed" ? cur.role : null;
    // Never lower (or touch) a higher role: an owner/admin/manager stays what they are.
    const role: OrgRole = previousRole && ORG_ROLE_RANK[previousRole] >= ORG_ROLE_RANK[locked.role] ? previousRole : locked.role;
    if (cur) {
      await d.query(
        `UPDATE account_members SET role = $3, status = 'active', "addedBy" = CASE WHEN status = 'removed' THEN $4 ELSE "addedBy" END, "updatedAt" = now()
         WHERE "accountId" = $1 AND "userId" = $2`,
        [locked.accountId, userId, role, locked.createdBy],
      );
    } else {
      await d.query(
        `INSERT INTO account_members ("accountId", "userId", role, status, "addedBy") VALUES ($1, $2, $3, 'active', $4)`,
        [locked.accountId, userId, role, locked.createdBy],
      );
    }
    await d.query(`UPDATE account_invitations SET "useCount" = "useCount" + 1 WHERE id = $1`, [locked.id]);
    await logAudit(d, {
      accountId: locked.accountId, actorUserId: userId, action: "organization.invitation_accepted", entityType: "account_invitation", entityId: locked.id,
      data: { invitationId: locked.id, userId, invitedRole: locked.role, role, previousRole },
    });
    return { accountId: locked.accountId, role };
  });
}

const byToken = (token: unknown) => db.one<InvRow>(`${SELECT_INV} WHERE i."tokenHash" = $1`, [sha256(String(token))]);
const invNotFound = () => new ApiError(404, "not_found", "Invitation not found");

export const accountInvitationsRouter = Router();
accountInvitationsRouter.use(requireAuth);

/** GET /account-invitations/:token — what the invitation is for, before accepting. */
accountInvitationsRouter.get("/:token", route(async (req, res) => {
  const i = await byToken(req.params.token);
  if (!i) throw invNotFound();
  const userId = authed(req).userId;
  const status = invStatus(i);
  const canAccept = status === "valid" && i.orgStatus === "active" && (await addressedTo(db, i, userId))
    && !membershipBlock(await memberOf(db, i.accountId, userId), i);
  res.json({
    id: i.id, accountId: i.accountId, orgName: i.orgName, orgStatus: i.orgStatus, role: i.role, invitedBy: i.invitedBy,
    status, forEmail: i.email, expiresAt: i.expiresAt, canAccept,
  });
}));

accountInvitationsRouter.post("/:token/accept", route(async (req, res) => {
  const i = await byToken(req.params.token);
  if (!i) throw invNotFound();
  res.json(await accept(i, authed(req).userId));
}));

/** Invitations addressed to me (my user, or an email I verified), still valid, org active. */
export const myAccountInvitationsRouter = Router();
myAccountInvitationsRouter.use(requireAuth);

myAccountInvitationsRouter.get("/", route(async (req, res) => {
  const userId = authed(req).userId;
  const rows = await db.query<InvRow>(
    `${SELECT_INV}
     WHERE i."revokedAt" IS NULL AND i."declinedAt" IS NULL AND i."expiresAt" > now() AND i."useCount" < i."maxUses" AND a.status = 'active'
       AND (i."userId" = $1 OR i.email IN (SELECT email FROM user_identities WHERE "userId" = $1 AND "emailVerified" AND email IS NOT NULL))
       AND NOT EXISTS (SELECT 1 FROM account_members m WHERE m."accountId" = i."accountId" AND m."userId" = $1 AND m.status IN ('active', 'suspended'))
     ORDER BY i."createdAt" DESC`,
    [userId],
  );
  res.json({ invitations: rows.map((i) => ({ id: i.id, accountId: i.accountId, orgName: i.orgName, role: i.role, invitedBy: i.invitedBy, expiresAt: i.expiresAt })) });
}));

/** A personal (email/user) invitation of mine by id; open links have no "mine". 404 otherwise. */
async function myInvitation(rawId: unknown, userId: string): Promise<InvRow> {
  if (!isUuid(rawId)) throw invNotFound();
  const i = await db.one<InvRow>(`${SELECT_INV} WHERE i.id = $1`, [rawId]);
  if (!i || !(i.userId || i.email) || !(await addressedTo(db, i, userId))) throw invNotFound();
  return i;
}

myAccountInvitationsRouter.post("/:id/accept", route(async (req, res) => {
  const userId = authed(req).userId;
  res.json(await accept(await myInvitation(req.params.id, userId), userId));
}));

myAccountInvitationsRouter.post("/:id/decline", route(async (req, res) => {
  const userId = authed(req).userId;
  const i = await myInvitation(req.params.id, userId);
  await tx(async (d) => {
    const n = await d.query(
      `UPDATE account_invitations SET "declinedAt" = now()
       WHERE id = $1 AND "declinedAt" IS NULL AND "revokedAt" IS NULL AND "useCount" < "maxUses" AND "expiresAt" > now()
       RETURNING id`, [i.id]);
    if (n.length === 0) throw new ApiError(410, "invitation_unavailable", "This invitation is no longer valid");
    await logAudit(d, {
      accountId: i.accountId, actorUserId: userId, action: "organization.invitation_declined", entityType: "account_invitation", entityId: i.id,
      data: { invitationId: i.id, role: i.role },
    });
  });
  res.status(204).end();
}));
