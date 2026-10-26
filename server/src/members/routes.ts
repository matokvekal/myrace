/**
 * Race members and invitations (FR-9–FR-13).
 *
 *  - Members: list, change roles/permissions/scope, revoke. The owner's
 *    membership is protected. Each change is a MemberChanged entry in the
 *    race's action log (audit) and reaches the member's open sockets at once.
 *  - Invitations: by email, existing user, directory contacts or groups, or an
 *    open link/QR. Access starts only when the invitee signs in and accepts;
 *    an email invitation must be accepted by an account that verified that email.
 *    Only a hash of the link secret is stored.
 */
import { randomUUID } from "node:crypto";
import { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { env } from "../config/env.js";
import { authed, loadUser, requireAuth } from "../auth/auth.js";
import { db, type Db, tx } from "../db/pool.js";
import { ApiError, normalizeEmail, randomToken, route, sha256 } from "../lib/core.js";
import { sendMail } from "../lib/messaging.js";
import { publishChanges, refreshMemberSockets } from "../realtime/socket.js";
import { validatePermissions, validateRoles, type MemberPermissions } from "../../../src/shared/race/access.js";
import { PROTOCOL_VERSION } from "../../../src/shared/race/actions.js";
import type { MemberRole } from "../../../src/shared/race/roles.js";
import { raceNotFound, requireMember } from "../races/access.js";
import { loadState } from "../races/repo.js";

const rolesSchema = z.array(z.string()).max(5).superRefine((v, c) => {
  const e = validateRoles(v);
  if (e) c.addIssue({ code: "custom", message: e });
});
const permissionsSchema = z.unknown().superRefine((v, c) => {
  const e = validatePermissions(v);
  if (e) c.addIssue({ code: "custom", message: e });
});

/** Records a membership change in the race log (audit) without changing race data. */
async function logMemberChange(d: Db, raceUuid: string, actorId: string, payload: { userId: string; roles: MemberRole[] | null; permissions: MemberPermissions }) {
  const s = await d.one<{ lastSeq: number }>(`UPDATE races SET "lastSeq" = "lastSeq" + 1 WHERE uuid = $1 RETURNING "lastSeq"`, [raceUuid]);
  await d.query(
    `INSERT INTO race_events ("actionId", "raceUuid", seq, type, payload, heat, "deviceTime", "clockOffsetMs", "deviceId", "protocolVersion", "userId", applied)
     VALUES ($1, $2, $3, 'MemberChanged', $4, NULL, now(), 0, 'server', $5, $6, true)`,
    [randomUUID(), raceUuid, s!.lastSeq, JSON.stringify(payload), PROTOCOL_VERSION, actorId],
  );
  return s!.lastSeq;
}

/** Advance every Device's cursor past a membership entry (it carries no race data). */
async function announceSeq(raceUuid: string, seq: number) {
  const state = await loadState(db, raceUuid);
  if (state) {
    await publishChanges(state, { raceUuid, seq, race: false, categories: new Set(), riders: new Set(), removedRiders: [], removedCategories: [], results: [] });
  }
}

export const membersRouter = Router({ mergeParams: true });
membersRouter.use(requireAuth);

const raceUuidOf = (req: { params: Record<string, unknown> }) => String(req.params.raceUuid);

membersRouter.get("/members", route(async (req, res) => {
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId, ["team", "view"]);
  const members = await db.query(
    `SELECT m."userId", u.name, u.email, m.roles, m.permissions, m."createdAt", m."updatedAt", m."revokedAt",
            (r."ownerUserId" = m."userId") AS "isOwner"
     FROM race_members m JOIN users u ON u.id = m."userId" JOIN races r ON r.uuid = m."raceUuid"
     WHERE m."raceUuid" = $1 ORDER BY "isOwner" DESC, m."createdAt"`,
    [m.raceUuid],
  );
  res.json({ members });
}));

membersRouter.patch("/members/:userId", route(async (req, res) => {
  const body = z.object({ roles: rolesSchema.optional(), permissions: permissionsSchema.optional() }).parse(req.body);
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId, ["team", "update"]);
  const target = String(req.params.userId);
  const seq = await tx(async (d) => {
    const race = await d.one<{ ownerUserId: string }>(`SELECT "ownerUserId" FROM races WHERE uuid = $1 FOR UPDATE`, [m.raceUuid]);
    if (race!.ownerUserId === target) throw new ApiError(403, "owner_protected", "The race owner's access cannot be changed");
    const cur = await d.one<{ roles: MemberRole[]; permissions: MemberPermissions }>(
      `SELECT roles, permissions FROM race_members WHERE "raceUuid" = $1 AND "userId" = $2 AND "revokedAt" IS NULL`,
      [m.raceUuid, target],
    );
    if (!cur) throw new ApiError(404, "not_found", "No such member");
    const roles = (body.roles as MemberRole[] | undefined) ?? cur.roles;
    const permissions = (body.permissions as MemberPermissions | undefined) ?? cur.permissions;
    await d.query(
      `UPDATE race_members SET roles = $3, permissions = $4, "updatedAt" = now() WHERE "raceUuid" = $1 AND "userId" = $2`,
      [m.raceUuid, target, roles, JSON.stringify(permissions)],
    );
    return logMemberChange(d, m.raceUuid, m.userId, { userId: target, roles, permissions });
  });
  await refreshMemberSockets(m.raceUuid, target);
  await announceSeq(m.raceUuid, seq);
  res.json({ ok: true });
}));

membersRouter.delete("/members/:userId", route(async (req, res) => {
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId, ["team", "update"]);
  const target = String(req.params.userId);
  const seq = await tx(async (d) => {
    const race = await d.one<{ ownerUserId: string }>(`SELECT "ownerUserId" FROM races WHERE uuid = $1 FOR UPDATE`, [m.raceUuid]);
    if (race!.ownerUserId === target) throw new ApiError(403, "owner_protected", "The race owner cannot be removed");
    const n = await d.query(
      `UPDATE race_members SET "revokedAt" = now(), "updatedAt" = now() WHERE "raceUuid" = $1 AND "userId" = $2 AND "revokedAt" IS NULL RETURNING 1`,
      [m.raceUuid, target],
    );
    if (n.length === 0) throw new ApiError(404, "not_found", "No such member");
    return logMemberChange(d, m.raceUuid, m.userId, { userId: target, roles: null, permissions: {} });
  });
  await refreshMemberSockets(m.raceUuid, target);
  await announceSeq(m.raceUuid, seq);
  res.status(204).end();
}));

// --- invitations ---

const inviteBody = z.object({
  emails: z.array(z.string().email()).max(200).default([]),
  userIds: z.array(z.string().uuid()).max(200).default([]),
  contactIds: z.array(z.string().uuid()).max(500).default([]),
  groupIds: z.array(z.string().uuid()).max(50).default([]),
  /** An open link/QR anyone signed in can use (up to maxUses times). */
  link: z.boolean().default(false),
  maxUses: z.number().int().min(1).max(500).default(1),
  roles: rolesSchema.default([]),
  permissions: permissionsSchema.default({}),
  expiresInDays: z.number().int().min(1).max(90).default(14),
  sendEmail: z.boolean().default(true),
  message: z.string().max(500).optional(),
});

const inviteUrl = (secret: string) => `${env.APP_URL.replace(/\/$/, "")}/invite/${secret}`;

membersRouter.post("/invitations", route(async (req, res) => {
  const body = inviteBody.parse(req.body);
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId, ["team", "update"]);
  const me = await loadUser(db, m.userId);
  const race = await db.one<{ name: string; date: string }>(`SELECT name, date FROM races WHERE uuid = $1`, [m.raceUuid]);

  // Resolve directory contacts and groups (the caller's own directory only).
  const contacts = await db.query<{ email: string | null; userId: string | null }>(
    `SELECT DISTINCT c.email, c."userId" FROM contacts c
     LEFT JOIN contact_group_members gm ON gm."contactId" = c.id
     LEFT JOIN contact_groups g ON g.id = gm."groupId"
     WHERE c."ownerUserId" = $1 AND (c.id = ANY($2::uuid[]) OR (g."ownerUserId" = $1 AND g.id = ANY($3::uuid[])))`,
    [m.userId, body.contactIds, body.groupIds],
  );
  const targets = new Map<string, { email: string | null; userId: string | null }>();
  for (const e of body.emails) targets.set(`e:${normalizeEmail(e)}`, { email: normalizeEmail(e), userId: null });
  for (const u of body.userIds) targets.set(`u:${u}`, { email: null, userId: u });
  for (const c of contacts) {
    if (c.userId) targets.set(`u:${c.userId}`, { email: null, userId: c.userId });
    else if (c.email) targets.set(`e:${c.email}`, { email: c.email, userId: null });
  }
  if (body.link) targets.set("link", { email: null, userId: null });
  if (targets.size === 0) throw new ApiError(400, "invalid", "Choose who to invite, or create a link");

  const expiresAt = new Date(Date.now() + body.expiresInDays * 86_400_000);
  const created = [];
  for (const [key, t] of targets) {
    if (t.userId && !(await db.one(`SELECT 1 FROM users WHERE id = $1`, [t.userId]))) continue;
    const secret = randomToken(24);
    const row = await db.one<{ id: string }>(
      `INSERT INTO invitations ("raceUuid", email, "userId", "tokenHash", roles, permissions, "maxUses", "createdBy", "expiresAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [m.raceUuid, t.email, t.userId, sha256(secret), body.roles, JSON.stringify(body.permissions), key === "link" ? body.maxUses : 1, m.userId, expiresAt],
    );
    const url = inviteUrl(secret);
    let emailTo = t.email;
    if (!emailTo && t.userId) emailTo = (await db.one<{ email: string | null }>(`SELECT email FROM users WHERE id = $1`, [t.userId]))?.email ?? null;
    if (body.sendEmail && emailTo) {
      await sendMail(
        emailTo,
        `${me.name} invites you to ${race!.name}`,
        `${me.name} invited you to help run "${race!.name}" (${race!.date}) on Commissaire.${body.message ? `\n\n${body.message}` : ""}\n\nOpen this link, sign in, and accept:\n${url}\n\nThe invitation expires on ${expiresAt.toDateString()}.`,
      );
      await db.query(`UPDATE invitations SET "sentAt" = now() WHERE id = $1`, [row!.id]);
    }
    created.push({ id: row!.id, email: t.email, userId: t.userId, link: key === "link", url, qrSvg: await QRCode.toString(url, { type: "svg", margin: 1 }) });
  }
  res.status(201).json({ invitations: created });
}));

membersRouter.get("/invitations", route(async (req, res) => {
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId, ["team", "view"]);
  const rows = await db.query(
    `SELECT i.id, i.email, i."userId", u.name AS "userName", i.roles, i.permissions, i."maxUses", i."useCount",
            i."createdAt", i."expiresAt", i."sentAt", i."revokedAt"
     FROM invitations i LEFT JOIN users u ON u.id = i."userId" WHERE i."raceUuid" = $1 ORDER BY i."createdAt" DESC`,
    [m.raceUuid],
  );
  res.json({ invitations: rows });
}));

membersRouter.delete("/invitations/:id", route(async (req, res) => {
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId, ["team", "update"]);
  await db.query(`UPDATE invitations SET "revokedAt" = now() WHERE id = $1 AND "raceUuid" = $2 AND "revokedAt" IS NULL`, [String(req.params.id), m.raceUuid]);
  res.status(204).end();
}));

// --- the invitee side ---

interface InvitationRow {
  id: string;
  raceUuid: string;
  email: string | null;
  userId: string | null;
  roles: MemberRole[];
  permissions: MemberPermissions;
  maxUses: number;
  useCount: number;
  expiresAt: Date;
  revokedAt: Date | null;
  raceName: string;
  raceDate: string;
  invitedBy: string;
}

const invitationStatus = (i: InvitationRow) =>
  i.revokedAt ? "revoked" : i.expiresAt < new Date() ? "expired" : i.useCount >= i.maxUses ? "used" : "valid";

const SELECT_INVITATION = `SELECT i.id, i."raceUuid", i.email, i."userId", i.roles, i.permissions, i."maxUses", i."useCount",
         i."expiresAt", i."revokedAt", r.name AS "raceName", r.date AS "raceDate", u.name AS "invitedBy"
  FROM invitations i JOIN races r ON r.uuid = i."raceUuid" JOIN users u ON u.id = i."createdBy"`;

/** May this user accept this invitation? Email invitations need that email verified on the account. */
async function canAccept(d: Db, i: InvitationRow, userId: string): Promise<boolean> {
  if (i.userId) return i.userId === userId;
  if (i.email) return !!(await d.one(`SELECT 1 FROM user_identities WHERE "userId" = $1 AND email = $2 AND "emailVerified"`, [userId, i.email]));
  return true; // open link
}

async function accept(i: InvitationRow, userId: string) {
  const seq = await tx(async (d) => {
    const locked = await d.one<InvitationRow>(`${SELECT_INVITATION} WHERE i.id = $1 FOR UPDATE OF i`, [i.id]);
    if (!locked || invitationStatus(locked) !== "valid") throw new ApiError(410, "invitation_unavailable", "This invitation is no longer valid");
    if (!(await canAccept(d, locked, userId))) {
      throw new ApiError(403, "wrong_account", locked.email ? `This invitation is for ${locked.email}. Sign in with that email (verified) to accept.` : "This invitation is for another account");
    }
    const owner = await d.one<{ ownerUserId: string }>(`SELECT "ownerUserId" FROM races WHERE uuid = $1`, [locked.raceUuid]);
    if (owner?.ownerUserId === userId) return null;
    await d.query(
      `INSERT INTO race_members ("raceUuid", "userId", roles, permissions, "invitationId", "addedBy")
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ("raceUuid", "userId") DO UPDATE SET roles = EXCLUDED.roles, permissions = EXCLUDED.permissions,
         "invitationId" = EXCLUDED."invitationId", "revokedAt" = NULL, "updatedAt" = now()`,
      [locked.raceUuid, userId, locked.roles, JSON.stringify(locked.permissions), locked.id, null],
    );
    await d.query(`UPDATE invitations SET "useCount" = "useCount" + 1 WHERE id = $1`, [locked.id]);
    return logMemberChange(d, locked.raceUuid, userId, { userId, roles: locked.roles, permissions: locked.permissions });
  });
  await refreshMemberSockets(i.raceUuid, userId);
  if (seq) await announceSeq(i.raceUuid, seq);
  return { raceUuid: i.raceUuid };
}

export const invitationsRouter = Router();
invitationsRouter.use(requireAuth);

/** GET /invitations/:token — what the invitation is for (race name, roles), before accepting. */
invitationsRouter.get("/:token", route(async (req, res) => {
  const i = await db.one<InvitationRow>(`${SELECT_INVITATION} WHERE i."tokenHash" = $1`, [sha256(String(req.params.token))]);
  if (!i) throw new ApiError(404, "not_found", "Invitation not found");
  res.json({
    id: i.id, raceUuid: i.raceUuid, raceName: i.raceName, raceDate: i.raceDate, invitedBy: i.invitedBy, roles: i.roles,
    waves: i.permissions.waves ?? null, status: invitationStatus(i), forEmail: i.email, canAccept: await canAccept(db, i, authed(req).userId),
  });
}));

invitationsRouter.post("/:token/accept", route(async (req, res) => {
  const i = await db.one<InvitationRow>(`${SELECT_INVITATION} WHERE i."tokenHash" = $1`, [sha256(String(req.params.token))]);
  if (!i) throw new ApiError(404, "not_found", "Invitation not found");
  res.json(await accept(i, authed(req).userId));
}));

/** Invitations addressed to me (my user, or an email I verified), still valid. */
export const myInvitationsRouter = Router();
myInvitationsRouter.use(requireAuth);

myInvitationsRouter.get("/", route(async (req, res) => {
  const userId = authed(req).userId;
  const rows = await db.query<InvitationRow>(
    `${SELECT_INVITATION}
     WHERE i."revokedAt" IS NULL AND i."expiresAt" > now() AND i."useCount" < i."maxUses"
       AND (i."userId" = $1 OR i.email IN (SELECT email FROM user_identities WHERE "userId" = $1 AND "emailVerified" AND email IS NOT NULL))
       AND NOT EXISTS (SELECT 1 FROM race_members m WHERE m."raceUuid" = i."raceUuid" AND m."userId" = $1 AND m."revokedAt" IS NULL)`,
    [userId],
  );
  res.json({ invitations: rows.map((i) => ({ id: i.id, raceUuid: i.raceUuid, raceName: i.raceName, raceDate: i.raceDate, invitedBy: i.invitedBy, roles: i.roles, waves: i.permissions.waves ?? null, expiresAt: i.expiresAt })) });
}));

myInvitationsRouter.post("/:id/accept", route(async (req, res) => {
  const i = await db.one<InvitationRow>(`${SELECT_INVITATION} WHERE i.id = $1`, [String(req.params.id)]);
  if (!i || !(i.userId || i.email)) throw raceNotFound();
  res.json(await accept(i, authed(req).userId));
}));

myInvitationsRouter.post("/:id/decline", route(async (req, res) => {
  const i = await db.one<InvitationRow>(`${SELECT_INVITATION} WHERE i.id = $1`, [String(req.params.id)]);
  if (!i || !(await canAccept(db, i, authed(req).userId)) || !(i.userId || i.email)) throw raceNotFound();
  await db.query(`UPDATE invitations SET "revokedAt" = now() WHERE id = $1`, [i.id]);
  res.status(204).end();
}));
