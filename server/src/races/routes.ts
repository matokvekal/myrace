/**
 * Races: create, publish a local race, My Races, read (filtered per member),
 * catch-up, the actions endpoint, history, devices, delete and transfer.
 * Every route under /races/:raceUuid checks the caller's membership first (AD-20).
 */
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { authed, requireAuth } from "../auth/auth.js";
import { db, tx } from "../db/pool.js";
import { ApiError, randomCode, route } from "../lib/core.js";
import { closeRace, refreshMemberSockets } from "../realtime/socket.js";
import { projectCategory, projectRace, projectRider, projectState, waveInScope } from "../../../src/shared/race/access.js";
import { deriveRider, rankRiders } from "../../../src/shared/race/engine.js";
import type { RaceState, SharedCategory, SharedRace, SharedRider } from "../../../src/shared/race/state.js";
import { accessSummary, loadMembership, raceNotFound, requireMember, requireOwner } from "./access.js";
import { processActions } from "./actions.js";
import { deleteRaceRows, insertRace, loadState } from "./repo.js";
import { newCategory, newRider } from "./schemas.js";

export const racesRouter = Router();
racesRouter.use(requireAuth);

const nowIso = () => new Date().toISOString();

function blankRace(uuid: string, ownerUserId: string, info: Partial<SharedRace>): SharedRace {
  return {
    uuid, ownerUserId, raceId: null, owner: "", name: "", location: "", time: "", date: "", image: "", heat: "", status: "upcoming",
    type: "", raceType: "MTB", level: "", orgenizer: "", manager: "", phone: "", takanon: "", site: "", map: "", distance: 0,
    isActive: true, autoColor: null, leaderFinishAll: null, waveColors: null, mapCenter: null, mapZoom: null, trackPoints: null,
    mapMarkers: null, tracks: null, joinCode: randomCode(8), lastSeq: 0, createdAt: nowIso(), lastUpdateAt: nowIso(),
    ...info,
  };
}

const raceInfo = z
  .object({
    raceId: z.string().max(200).nullable(), owner: z.string().max(200), name: z.string().trim().min(1).max(200),
    location: z.string().max(300), time: z.string().max(50), date: z.string().max(50), image: z.string().max(2_000_000),
    heat: z.string().max(50), type: z.string().max(100), raceType: z.enum(["MTB", "Gravel"]).nullable(), level: z.string().max(100),
    orgenizer: z.string().max(200), manager: z.string().max(200), phone: z.string().max(50), takanon: z.string().max(100_000),
    site: z.string().max(500), map: z.string().max(2_000_000), distance: z.number(), isActive: z.boolean(),
    autoColor: z.boolean().nullable(), leaderFinishAll: z.boolean().nullable(),
    waveColors: z.record(z.string(), z.string()).nullable(), mapCenter: z.object({ lat: z.number(), lng: z.number() }).nullable(),
    mapZoom: z.number().nullable(), trackPoints: z.array(z.tuple([z.number(), z.number()])).nullable(),
    mapMarkers: z.array(z.any()).nullable(), tracks: z.array(z.any()).nullable(),
  })
  .partial()
  .required({ name: true });

async function addOwnerMembership(d: import("../db/pool.js").Db, raceUuid: string, userId: string) {
  await d.query(`INSERT INTO race_members ("raceUuid", "userId", roles, "addedBy") VALUES ($1, $2, '{admin}', $2)`, [raceUuid, userId]);
}

/** POST /races — a new, empty shared race owned by the caller. */
racesRouter.post("/", route(async (req, res) => {
  const info = raceInfo.parse(req.body);
  const userId = authed(req).userId;
  const state: RaceState = { race: blankRace(randomUUID(), userId, info as Partial<SharedRace>), categories: {}, riders: {} };
  await tx(async (d) => {
    await insertRace(d, state);
    await addOwnerMembership(d, state.race.uuid, userId);
    await d.query(`INSERT INTO race_snapshots ("raceUuid", seq, data) VALUES ($1, 0, $2)`, [state.race.uuid, JSON.stringify(state)]);
  });
  res.status(201).json({ race: state.race });
}));

/**
 * POST /races/publish — share a local race (before any wave starts). The server
 * assigns the race uuid; categories and riders keep the uuids the Device made.
 * Contact data, "Keep as info" columns and ID numbers are never accepted (strict schemas).
 */
const publishBody = z.object({
  race: raceInfo,
  categories: z.array(newCategory).max(500),
  riders: z.array(newRider.extend({ checked: z.boolean().optional(), status: z.enum(["standing", "DNS"]).optional() })).max(5000),
});
racesRouter.post("/publish", route(async (req, res) => {
  const body = publishBody.parse(req.body);
  const userId = authed(req).userId;
  const raceUuid = randomUUID();
  const state: RaceState = { race: blankRace(raceUuid, userId, body.race as Partial<SharedRace>), categories: {}, riders: {} };
  for (const c of body.categories) {
    state.categories[c.uuid] = {
      uuid: c.uuid, raceUuid, name: c.name, subCategory: c.subCategory ?? null, laps: c.laps ?? null, startTime: c.startTime ?? null,
      isConnected: false, color: c.color ?? null, heat: c.heat ?? null, status: "upcoming", linkedFinish: null,
      linkGroup: c.linkGroup ?? null, startedAt: null, finishedAt: null, importOrder: c.importOrder ?? null,
    } satisfies SharedCategory;
  }
  const bibs = body.riders.map((r) => r.bibNumber).filter((b) => b != null);
  for (const r of body.riders) {
    state.riders[r.uuid] = {
      ...r, raceUuid, middleName: r.middleName ?? null, bibNumber: r.bibNumber ?? null, team: r.team ?? null, chipNumber: r.chipNumber ?? null,
      federation: r.federation ?? null, points: r.points ?? null, subCategory: r.subCategory ?? null, heat: r.heat ?? null,
      standing: r.standing ?? null, flag: r.flag ?? null, uciPoints: r.uciPoints ?? null, uciNumber: r.uciNumber ?? null,
      image: r.image ?? null, comment: r.comment ?? null, checked: r.checked ?? false, status: r.status ?? "standing",
      viewOrder: 0, raceStatus: "upcoming", timeStartRace: null, timeArrive: null, lapsCounter: 0, lapsDetails: [], totalLaps: 0,
      elapsedLastLap: null, elapsedTimeFromStart: null, distance: null, position_start: null, position_category: 0, position_race: 0,
      color: null, createdAt: nowIso(), updatedAt: nowIso(),
    } satisfies SharedRider;
  }
  for (const uuid of Object.keys(state.riders)) deriveRider(state, uuid, []);
  rankRiders(state);
  await tx(async (d) => {
    const clash = await d.one(
      `SELECT 1 FROM riders WHERE uuid = ANY($1::uuid[]) UNION ALL SELECT 1 FROM categories WHERE uuid = ANY($2::uuid[]) LIMIT 1`,
      [Object.keys(state.riders), Object.keys(state.categories)],
    );
    if (clash) throw new ApiError(409, "already_published", "This race was already published");
    await insertRace(d, state);
    await addOwnerMembership(d, raceUuid, userId);
    await d.query(`INSERT INTO race_snapshots ("raceUuid", seq, data) VALUES ($1, 0, $2)`, [raceUuid, JSON.stringify(state)]);
  });
  res.status(201).json({ race: state.race, duplicateBibs: bibs.length !== new Set(bibs).size });
}));

/** GET /races — My Races: owned and joined, with my access in each. */
racesRouter.get("/", route(async (req, res) => {
  const userId = authed(req).userId;
  const rows = await db.query<{ uuid: string }>(
    `SELECT r.uuid FROM races r LEFT JOIN race_members m ON m."raceUuid" = r.uuid AND m."userId" = $1 AND m."revokedAt" IS NULL
     WHERE r."ownerUserId" = $1 OR m.id IS NOT NULL ORDER BY r."lastUpdateAt" DESC`,
    [userId],
  );
  const out = [];
  for (const { uuid } of rows) {
    const m = await loadMembership(db, uuid, userId);
    const state = await loadState(db, uuid);
    if (!m || m.revoked || !state) continue;
    out.push({ race: projectRace(m.access, state.race), access: accessSummary(m) });
  }
  res.json({ races: out });
}));

/** GET /races/join/:code — the race behind a join code, for its members only. */
racesRouter.get("/join/:code", route(async (req, res) => {
  const r = await db.one<{ uuid: string }>(`SELECT uuid FROM races WHERE "joinCode" = $1`, [String(req.params.code).toUpperCase()]);
  if (!r) throw raceNotFound();
  await requireMember(db, r.uuid, authed(req).userId);
  res.json({ raceUuid: r.uuid });
}));

const raceUuidOf = (req: { params: Record<string, unknown> }) => String(req.params.raceUuid);

racesRouter.get("/:raceUuid", route(async (req, res) => {
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId);
  const state = await loadState(db, m.raceUuid);
  if (!state) throw raceNotFound();
  res.json({ race: projectRace(m.access, state.race), access: accessSummary(m) });
}));

/** GET /races/:raceUuid/snapshot — everything this member may see, and the sequence it is current to. */
racesRouter.get("/:raceUuid/snapshot", route(async (req, res) => {
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId);
  const state = await loadState(db, m.raceUuid);
  if (!state) throw raceNotFound();
  res.json({ lastSeq: state.race.lastSeq, access: accessSummary(m), ...projectState(m.access, state) });
}));

/**
 * GET /races/:raceUuid/changes?afterSeq=n — rows changed after n, filtered for
 * this member, plus removals. A Device far behind gets `snapshot: true` and
 * should download the snapshot instead.
 */
racesRouter.get("/:raceUuid/changes", route(async (req, res) => {
  const afterSeq = z.coerce.number().int().min(0).parse(req.query.afterSeq ?? 0);
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId);
  const state = await loadState(db, m.raceUuid);
  if (!state) throw raceNotFound();
  if (state.race.lastSeq - afterSeq > 5000) return res.json({ snapshot: true, lastSeq: state.race.lastSeq });
  const riders = await db.query<{ uuid: string }>(`SELECT uuid FROM riders WHERE "raceUuid" = $1 AND "changedSeq" > $2`, [m.raceUuid, afterSeq]);
  const cats = await db.query<{ uuid: string }>(`SELECT uuid FROM categories WHERE "raceUuid" = $1 AND "changedSeq" > $2`, [m.raceUuid, afterSeq]);
  const raceChanged = await db.one(`SELECT 1 FROM races WHERE uuid = $1 AND "changedSeq" > $2`, [m.raceUuid, afterSeq]);
  const removed = await db.query<{ type: string; uuid: string; heat: number | null }>(
    `SELECT type, COALESCE(payload->>'riderUuid', payload->>'categoryUuid') AS uuid, heat FROM race_events
     WHERE "raceUuid" = $1 AND seq > $2 AND applied AND type IN ('RiderDeleted', 'CategoryDeleted')`,
    [m.raceUuid, afterSeq],
  );
  const visibleRemovals = removed.filter((r) => m.access.waves === null || waveInScope(m.access, r.heat));
  res.json({
    lastSeq: state.race.lastSeq,
    access: accessSummary(m),
    race: raceChanged ? projectRace(m.access, state.race) : undefined,
    categories: cats.map((c) => state.categories[c.uuid]).filter((c): c is SharedCategory => !!c && !!projectCategory(m.access, c)),
    riders: riders
      .map((r) => state.riders[r.uuid])
      .filter((r): r is SharedRider => !!r)
      .map((r) => projectRider(m.access, state, r))
      .filter((r) => r !== null),
    removedRiders: visibleRemovals.filter((r) => r.type === "RiderDeleted").map((r) => r.uuid),
    removedCategories: visibleRemovals.filter((r) => r.type === "CategoryDeleted").map((r) => r.uuid),
  });
}));

/** POST /races/:raceUuid/actions — a batch of Actions (≤ 100), in the Device's local order. */
racesRouter.post("/:raceUuid/actions", route(async (req, res) => {
  const body = z.object({ actions: z.array(z.unknown()).min(1).max(100) }).parse(req.body);
  const results = await processActions(raceUuidOf(req), authed(req).userId, body.actions);
  res.json({ results });
}));

/**
 * GET /races/:raceUuid/history?afterSeq&riderUuid — the action log. The full
 * audit (authors, devices) needs Team; a rider's own history needs a view of
 * that rider. Hidden waves are never included.
 */
racesRouter.get("/:raceUuid/history", route(async (req, res) => {
  const qs = z.object({ afterSeq: z.coerce.number().int().min(0).default(0), riderUuid: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(1000).default(500) }).parse(req.query);
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId);
  const state = await loadState(db, m.raceUuid);
  if (!state) throw raceNotFound();
  const audit = m.access.screens.team.view;
  if (qs.riderUuid) {
    const r = state.riders[qs.riderUuid];
    if (!r || !projectRider(m.access, state, r)) throw new ApiError(404, "not_found", "No such rider");
  } else if (!audit) {
    throw new ApiError(403, "forbidden", "The audit history needs access to Team");
  }
  const rows = await db.query<Record<string, unknown>>(
    `SELECT e.seq, e."actionId", e.type, e.payload, e.heat, e."deviceTime", e."clockOffsetMs", e."eventAt", e."clockCheck", e."serverReceivedAt", e.applied, e.reason,
            e."deviceId", e."userId", u.name AS "userName"
     FROM race_events e LEFT JOIN users u ON u.id = e."userId"
     WHERE e."raceUuid" = $1 AND e.seq > $2 AND ($3::text IS NULL OR e.payload->>'riderUuid' = $3)
       AND ($4::int[] IS NULL OR e.heat IS NULL OR e.heat = ANY($4::int[]))
     ORDER BY e.seq LIMIT $5`,
    [m.raceUuid, qs.afterSeq, qs.riderUuid ?? null, m.access.waves, qs.limit],
  );
  res.json({
    events: rows.map((e) => (audit ? e : { seq: e.seq, type: e.type, eventAt: e.eventAt, applied: e.applied, reason: e.reason })),
  });
}));

/** POST /races/:raceUuid/sync — a Device reports its cursor and queue (team sync view). */
racesRouter.post("/:raceUuid/sync", route(async (req, res) => {
  const body = z.object({ deviceId: z.string().min(1).max(100), lastSeq: z.number().int().min(0), pendingCount: z.number().int().min(0), appVersion: z.string().max(40).optional() }).parse(req.body);
  const m = await loadMembership(db, raceUuidOf(req), authed(req).userId);
  if (!m) throw raceNotFound();
  // Under the race row lock (FOR SHARE), so a race deleted meanwhile leaves no cursor behind.
  await tx(async (d) => {
    if (!(await d.one(`SELECT 1 FROM races WHERE uuid = $1 FOR SHARE`, [m.raceUuid]))) throw raceNotFound();
    await d.query(
      `INSERT INTO sync_cursors ("raceUuid", "deviceId", "userId", "lastSeq", "pendingCount", "appVersion", "lastSeenAt")
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT ("raceUuid", "deviceId") DO UPDATE SET "userId" = EXCLUDED."userId", "lastSeq" = EXCLUDED."lastSeq",
         "pendingCount" = EXCLUDED."pendingCount", "appVersion" = EXCLUDED."appVersion", "lastSeenAt" = now()`,
      [m.raceUuid, body.deviceId, m.userId, body.lastSeq, body.pendingCount, body.appVersion ?? null],
    );
  });
  const last = await db.one<{ lastSeq: number }>(`SELECT "lastSeq" FROM races WHERE uuid = $1`, [m.raceUuid]);
  res.json({ lastSeq: last?.lastSeq ?? 0, serverTime: Date.now() });
}));

/** GET /races/:raceUuid/devices — every Device's sync state (owner/admin team view). */
racesRouter.get("/:raceUuid/devices", route(async (req, res) => {
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId, ["team", "view"]);
  const rows = await db.query(
    `SELECT c."deviceId", c."userId", u.name AS "userName", c."lastSeq", c."pendingCount", c."appVersion", c."lastSeenAt"
     FROM sync_cursors c LEFT JOIN users u ON u.id = c."userId" WHERE c."raceUuid" = $1 ORDER BY c."lastSeenAt" DESC`,
    [m.raceUuid],
  );
  res.json({ devices: rows });
}));

/** POST /races/:raceUuid/join-code — a new join code (the old one stops working). */
racesRouter.post("/:raceUuid/join-code", route(async (req, res) => {
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId, ["team", "update"]);
  const code = randomCode(8);
  await db.query(`UPDATE races SET "joinCode" = $2 WHERE uuid = $1`, [m.raceUuid, code]);
  res.json({ joinCode: code });
}));

/** POST /races/:raceUuid/transfer — hand ownership to another active member (owner only). */
racesRouter.post("/:raceUuid/transfer", route(async (req, res) => {
  const { userId: target } = z.object({ userId: z.string().uuid() }).parse(req.body);
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId);
  requireOwner(m);
  await tx(async (d) => {
    // Race row lock first: a concurrent delete either finishes before (404) or waits.
    if (!(await d.one(`SELECT 1 FROM races WHERE uuid = $1 FOR UPDATE`, [m.raceUuid]))) throw raceNotFound();
    const ok = await d.one(`SELECT 1 FROM race_members WHERE "raceUuid" = $1 AND "userId" = $2 AND "revokedAt" IS NULL`, [m.raceUuid, target]);
    if (!ok) throw new ApiError(400, "invalid", "The new owner must be an active member of the race");
    await d.query(`UPDATE races SET "ownerUserId" = $2 WHERE uuid = $1`, [m.raceUuid, target]);
    await d.query(
      `INSERT INTO race_members ("raceUuid", "userId", roles, "addedBy") VALUES ($1, $2, '{admin}', $2)
       ON CONFLICT ("raceUuid", "userId") DO UPDATE SET roles = '{admin}', "revokedAt" = NULL, "updatedAt" = now()`,
      [m.raceUuid, m.userId],
    );
  });
  await refreshMemberSockets(m.raceUuid, m.userId);
  await refreshMemberSockets(m.raceUuid, target);
  res.json({ ownerUserId: target });
}));

/** DELETE /races/:raceUuid — owner only; removes the race and every row of it, in one transaction. */
racesRouter.delete("/:raceUuid", route(async (req, res) => {
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId);
  requireOwner(m);
  if (!(await tx((d) => deleteRaceRows(d, m.raceUuid)))) throw raceNotFound();
  await closeRace(m.raceUuid);
  res.status(204).end();
}));
