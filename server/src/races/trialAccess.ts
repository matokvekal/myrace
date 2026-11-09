/**
 * Quick Trial Access (014) — the platform owner's link (TRIAL_LINK_ISSUERS, verified email,
 * own races only) that lets a NEW judge try the system
 * without registering: open the link → a temporary user, an ordinary race membership
 * and a session are created → the judge is in the race.
 *
 * Nothing new is decided here about what a judge may do: the trial user is a normal
 * race_members row with the link's roles, so the existing authorization
 * (loadMembership → effectiveAccess → authorizeAction), sync, sockets and audit apply.
 * What is specific to trial users lives in three places only:
 *  - races/access.ts  loadMembership: an ended trial = a removed member;
 *  - auth/auth.ts     requireAuth: no account-level writes (races, invitations, trial
 *                     links, profile, identities, contacts, organizations);
 *  - auth/tokens.ts   sessions never outlive the trial.
 *
 * Two independent expiries: the LINK's (until when it can be opened) and the trial
 * user's ACCESS (until when it may work). An expired link never ends an active trial.
 * Revoking a link ends the trials it created. Users, memberships and race_events are
 * never deleted: the audit history stays.
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { authed, loadUser, requireAuth } from "../auth/auth.js";
import { createSession } from "../auth/tokens.js";
import { env } from "../config/env.js";
import { db, type Db, tx } from "../db/pool.js";
import { ApiError, randomToken, route, sha256 } from "../lib/core.js";
import { refreshMemberSockets } from "../realtime/socket.js";
import type { MemberPermissions } from "../../../src/shared/race/access.js";
import type { MemberRole } from "../../../src/shared/race/roles.js";
import { raceNotFound, requireMember, requireOwner } from "./access.js";
import { announceSeq, logServerEvent } from "./audit.js";

/** Roles a trial link may give: the judging roles, never admin (no team management). */
export const TRIAL_ROLES = ["start", "counter", "checkin", "results", "viewer"] as const;
export const DEFAULT_TRIAL_ROLES: MemberRole[] = ["start", "counter", "checkin", "results"];
export const TRIAL_DEFAULTS = { maxUses: 10, linkExpiresInDays: 7 } as const;
/** A trial judge works for 24 h from their own first successful activation, whatever the race date. */
export const TRIAL_ACCESS_HOURS = 24;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** When a trial activated at `now` ends. */
export const trialAccessUntil = (now = Date.now()): Date => new Date(now + TRIAL_ACCESS_HOURS * HOUR);

const trialUrl = (secret: string) => `${env.APP_URL.replace(/\/$/, "")}/trial/${secret}`;

const disabled = () => new ApiError(404, "trial_disabled", "Quick Trial Access is not available");
/** One answer for every unusable link, so it tells nothing about the race behind it. */
const unavailable = () => new ApiError(410, "trial_link_unavailable", "This trial link can't be used any more. Ask the race owner for a new one.");

const linkStatus = (l: { revokedAt: Date | null; expiresAt: Date; useCount: number; maxUses: number }) =>
  l.revokedAt ? "revoked" : l.expiresAt <= new Date() ? "expired" : l.useCount >= l.maxUses ? "used" : "valid";

// ---------------------------------------------------------------------------
// Owner: create, list, revoke — /api/v1/races/:raceUuid/trial-links

export const trialLinksRouter = Router({ mergeParams: true });
trialLinksRouter.use("/trial-links", requireAuth);
trialLinksRouter.use("/trial-links", rateLimit({ windowMs: 60_000, limit: Number(process.env.TRIAL_RATE_LIMIT ?? 30), standardHeaders: true, legacyHeaders: false }));

const raceUuidOf = (req: { params: Record<string, unknown> }) => String(req.params.raceUuid);

/**
 * May this account create trial links? Its primary email must be in TRIAL_LINK_ISSUERS AND
 * proven (a verified identity with that email) — an unverified sign-up for the same address
 * never qualifies. Never taken from the request: read from the authenticated account.
 */
export async function isTrialIssuer(d: Db, userId: string): Promise<boolean> {
  if (env.TRIAL_LINK_ISSUERS.length === 0) return false;
  // On the CALLER's connection: inside a transaction a second pool connection could deadlock the pool.
  return !!(await d.one(
    `SELECT 1 FROM users u WHERE u.id = $1 AND u."isActive" AND u.email = ANY($2::text[])
       AND EXISTS (SELECT 1 FROM user_identities i WHERE i."userId" = u.id AND i.email = u.email AND i."emailVerified")`,
    [userId, env.TRIAL_LINK_ISSUERS],
  ));
}

/** Trial links: the feature is on, the caller is a trial-link issuer, and owns this race. */
async function requireTrialOwner(req: Parameters<typeof authed>[0]) {
  if (!env.TRIAL_ACCESS_ENABLED) throw disabled();
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId);
  requireOwner(m);
  if (!(await isTrialIssuer(db, m.userId))) throw new ApiError(403, "trial_issuer_only", "Trial links are not available for this account");
  return m;
}

const createBody = z.object({
  roles: z.array(z.enum(TRIAL_ROLES)).min(1).max(TRIAL_ROLES.length).refine((r) => new Set(r).size === r.length, "roles must not repeat").default(DEFAULT_TRIAL_ROLES as (typeof TRIAL_ROLES)[number][]),
  waves: z.array(z.number().int().min(0)).min(1).max(100).optional(),
  maxUses: z.number().int().min(1).max(500).default(TRIAL_DEFAULTS.maxUses),
  linkExpiresInDays: z.number().int().min(1).max(90).default(TRIAL_DEFAULTS.linkExpiresInDays),
});

/** POST /races/:raceUuid/trial-links — a new link (race owner). The URL is returned once; only its hash is stored. */
trialLinksRouter.post("/trial-links", route(async (req, res) => {
  const body = createBody.parse(req.body ?? {});
  const m = await requireTrialOwner(req);
  const secret = randomToken(32);
  const permissions: MemberPermissions = body.waves ? { waves: [...new Set(body.waves)] } : {};
  const { link, seq } = await tx(async (d) => {
    if (!(await d.one(`SELECT 1 FROM races WHERE uuid = $1 AND "deletedAt" IS NULL FOR UPDATE`, [m.raceUuid]))) throw raceNotFound();
    const expiresAt = new Date(Date.now() + body.linkExpiresInDays * DAY);
    // The latest any trial from this link can end (activated just before the link expires);
    // each trial judge's own end is set when they activate (24 h from then).
    const accessUntil = trialAccessUntil(expiresAt.getTime());
    const link = await d.one<{ id: string; createdAt: Date }>(
      `INSERT INTO trial_links ("raceUuid", "createdBy", "tokenHash", roles, permissions, "maxUses", "expiresAt", "accessUntil")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, "createdAt"`,
      [m.raceUuid, m.userId, sha256(secret), body.roles, JSON.stringify(permissions), body.maxUses, expiresAt, accessUntil],
    );
    const seq = await logServerEvent(d, m.raceUuid, m.userId, "RaceAdmin", {
      op: "trialLinkCreated", linkId: link!.id, roles: body.roles, maxUses: body.maxUses,
      expiresAt: expiresAt.toISOString(), accessUntil: accessUntil.toISOString(),
    });
    return { link: { id: link!.id, createdAt: link!.createdAt, expiresAt, accessUntil }, seq };
  });
  await announceSeq(m.raceUuid, seq);
  res.status(201).json({
    id: link.id, url: trialUrl(secret), roles: body.roles, waves: permissions.waves ?? null, maxUses: body.maxUses, useCount: 0,
    createdAt: link.createdAt, expiresAt: link.expiresAt, accessUntil: link.accessUntil, status: "valid", activeUsers: 0,
  });
}));

/** GET /races/:raceUuid/trial-links — the race's links (never their secrets) and how many trial judges each has. */
trialLinksRouter.get("/trial-links", route(async (req, res) => {
  const m = await requireTrialOwner(req);
  const rows = await db.query<{ id: string; roles: MemberRole[]; permissions: MemberPermissions; maxUses: number; useCount: number; createdAt: Date; expiresAt: Date; accessUntil: Date; revokedAt: Date | null; activeUsers: number }>(
    `SELECT l.id, l.roles, l.permissions, l."maxUses", l."useCount", l."createdAt", l."expiresAt", l."accessUntil", l."revokedAt",
            (SELECT count(*)::int FROM temporary_users t WHERE t."linkId" = l.id AND t."revokedAt" IS NULL AND t."expiresAt" > now()) AS "activeUsers"
     FROM trial_links l WHERE l."raceUuid" = $1 ORDER BY l."createdAt" DESC`,
    [m.raceUuid],
  );
  res.json({
    links: rows.map(({ permissions, ...l }) => ({ ...l, waves: permissions.waves ?? null, status: linkStatus(l) })),
    defaults: { roles: DEFAULT_TRIAL_ROLES, ...TRIAL_DEFAULTS },
  });
}));

/** DELETE /races/:raceUuid/trial-links/:id — revoke: the link stops working and every trial it created ends now. */
trialLinksRouter.delete("/trial-links/:id", route(async (req, res) => {
  const m = await requireTrialOwner(req);
  const id = z.string().uuid().parse(req.params.id);
  const { ended, seq } = await tx(async (d) => {
    if (!(await d.one(`SELECT 1 FROM races WHERE uuid = $1 FOR UPDATE`, [m.raceUuid]))) throw raceNotFound();
    const link = await d.one<{ revokedAt: Date | null }>(`SELECT "revokedAt" FROM trial_links WHERE id = $1 AND "raceUuid" = $2 FOR UPDATE`, [id, m.raceUuid]);
    if (!link) throw new ApiError(404, "not_found", "No such trial link");
    if (!link.revokedAt) await d.query(`UPDATE trial_links SET "revokedAt" = now(), "revokedBy" = $2 WHERE id = $1`, [id, m.userId]);
    const ended = await d.query<{ userId: string }>(
      `UPDATE temporary_users SET "revokedAt" = now() WHERE "linkId" = $1 AND "revokedAt" IS NULL RETURNING "userId"`,
      [id],
    );
    // Sessions are NOT revoked: every request and refresh of an ended trial answers 403
    // "trial_ended" (requireAuth, refreshSession), which tells the device why it lost access.
    const seq = link.revokedAt && !ended.length ? null : await logServerEvent(d, m.raceUuid, m.userId, "RaceAdmin", { op: "trialLinkRevoked", linkId: id, endedUsers: ended.length });
    return { ended, seq };
  });
  for (const u of ended) await refreshMemberSockets(m.raceUuid, u.userId);
  if (seq) await announceSeq(m.raceUuid, seq);
  res.json({ revoked: true, endedUsers: ended.length });
}));

// ---------------------------------------------------------------------------
// New judge: open a link — /api/v1/trial/:token/start (no account, no sign-in)

export const trialRouter = Router();
trialRouter.use(rateLimit({ windowMs: 60_000, limit: Number(process.env.TRIAL_RATE_LIMIT ?? 30), standardHeaders: true, legacyHeaders: false }));

const startBody = z.object({
  deviceId: z.string().min(1).max(100).optional(),
  name: z.string().trim().max(60).optional(),
});

/**
 * POST /trial/:token/start — creates a temporary user, its membership in the link's race
 * (the link's roles) and a session that ends with the trial. Answers like a sign-in, plus
 * the race to open. Every unusable link (revoked, expired, used up, race gone) gets the
 * same 410; an unknown one 404.
 */
trialRouter.post("/:token/start", route(async (req, res) => {
  if (!env.TRIAL_ACCESS_ENABLED) throw disabled();
  const token = String(req.params.token);
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) throw new ApiError(404, "trial_link_invalid", "This trial link is not valid");
  const body = startBody.parse(req.body ?? {});
  const userAgent = req.headers["user-agent"]?.slice(0, 300) ?? null;
  const found = await db.one<{ raceUuid: string }>(`SELECT "raceUuid" FROM trial_links WHERE "tokenHash" = $1`, [sha256(token)]);
  if (!found) throw new ApiError(404, "trial_link_invalid", "This trial link is not valid");
  const { out, seq } = await tx(async (d) => {
    // Lock order race → link, the same as revoke (opposite orders deadlock).
    const race = await d.one<{ ownerUserId: string; deletedAt: Date | null }>(`SELECT "ownerUserId", "deletedAt" FROM races WHERE uuid = $1 FOR UPDATE`, [found.raceUuid]);
    const link = await d.one<{ id: string; raceUuid: string; createdBy: string; roles: MemberRole[]; permissions: MemberPermissions; maxUses: number; useCount: number; expiresAt: Date; accessUntil: Date; revokedAt: Date | null }>(
      `SELECT id, "raceUuid", "createdBy", roles, permissions, "maxUses", "useCount", "expiresAt", "accessUntil", "revokedAt"
       FROM trial_links WHERE "tokenHash" = $1 FOR UPDATE`,
      [sha256(token)],
    );
    if (!link) throw new ApiError(404, "trial_link_invalid", "This trial link is not valid");
    // Only a link from the race's CURRENT owner works (ownership may have moved since).
    if (!race || race.deletedAt || race.ownerUserId !== link.createdBy || linkStatus(link) !== "valid") throw unavailable();
    // …and only while its creator is still an allowed trial-link issuer.
    if (!(await isTrialIssuer(d, link.createdBy))) throw unavailable();
    const name = body.name || `Trial judge ${link.useCount + 1}`;
    const user = await d.one<{ id: string }>(`INSERT INTO users (email, name) VALUES (NULL, $1) RETURNING id`, [name]);
    const userId = user!.id;
    await d.query(
      `INSERT INTO race_members ("raceUuid", "userId", roles, permissions, "addedBy") VALUES ($1, $2, $3, $4, $5)`,
      [link.raceUuid, userId, link.roles, JSON.stringify(link.permissions), link.createdBy],
    );
    // 24 h from THIS judge's first successful activation, regardless of the race date.
    const accessUntil = trialAccessUntil();
    await d.query(`INSERT INTO temporary_users ("userId", "raceUuid", "linkId", "expiresAt") VALUES ($1, $2, $3, $4)`, [userId, link.raceUuid, link.id, accessUntil]);
    await d.query(`UPDATE trial_links SET "useCount" = "useCount" + 1 WHERE id = $1`, [link.id]);
    await logServerEvent(d, link.raceUuid, userId, "MemberChanged", { userId, roles: link.roles, permissions: link.permissions });
    const seq = await logServerEvent(d, link.raceUuid, userId, "RaceAdmin", { op: "trialUserStarted", linkId: link.id, userId, accessUntil: accessUntil.toISOString() });
    const tokens = await createSession(d, userId, body.deviceId ?? null, userAgent, accessUntil);
    return { out: { ...tokens, user: await loadUser(d, userId), raceUuid: link.raceUuid, accessUntil }, seq };
  });
  await announceSeq(out.raceUuid, seq);
  res.status(201).json(out);
}));
