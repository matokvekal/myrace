/**
 * Results and official versions (FR-32–34, AD-13).
 *
 *  - GET  /races/:raceUuid/results  — live classification per category (filtered per member).
 *  - POST /races/:raceUuid/finalize — owner: closes every open wave (riders on track finish on
 *    their completed laps, never DNF), computes the result and issues official version 1.
 *  - POST /races/:raceUuid/amend    — owner: accepts listed late Actions and issues version n+1.
 *  - GET  /races/:raceUuid/official — every version, with the server signature.
 *
 * The record is the app's RaceFinalization (SHA-256 token over the payload) plus
 * an Ed25519 server signature of the token, so it proves who issued it.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { authed, loadUser, requireAuth } from "../auth/auth.js";
import { db, type Db, tx } from "../db/pool.js";
import { ApiError, logger, route, sha256 } from "../lib/core.js";
import { publishChanges, type CommittedChanges } from "../realtime/socket.js";
import { projectRider } from "../../../src/shared/race/access.js";
import { PROTOCOL_VERSION, type RaceAction } from "../../../src/shared/race/actions.js";
import { actionTime, applyAction, categoryKey } from "../../../src/shared/race/engine.js";
import type { RaceState, SharedRider } from "../../../src/shared/race/state.js";
import { raceNotFound, requireMember, requireOwner } from "../races/access.js";
import { rederive } from "../races/actions.js";
import { loadState, saveChanges } from "../races/repo.js";

export const FINALIZE_SIGNATURE_VERSION = "commissaire-race-final/v1";

let signingKey: KeyObject | null = null;
function key(): KeyObject {
  if (signingKey) return signingKey;
  if (env.RESULTS_SIGNING_KEY) {
    signingKey = createPrivateKey(env.RESULTS_SIGNING_KEY.replace(/\\n/g, "\n"));
  } else {
    if (env.NODE_ENV === "production") throw new ApiError(503, "signing_key_missing", "Official results cannot be signed: RESULTS_SIGNING_KEY is not set");
    signingKey = generateKeyPairSync("ed25519").privateKey;
    logger.warn("RESULTS_SIGNING_KEY not set — using a temporary development key");
  }
  return signingKey;
}
export const publicKeyPem = () => createPublicKey(key()).export({ type: "spki", format: "pem" }).toString();

/** riderResultsDigest from utils/raceSignature.ts, keyed by the rider uuid. */
const digest = (riders: SharedRider[]) =>
  [...riders]
    .sort((a, b) => a.uuid.localeCompare(b.uuid))
    .map((r) => [r.uuid, r.bibNumber, r.lapsCounter ?? 0, r.status ?? "", r.raceStatus ?? "", r.position_category ?? 0, r.elapsedTimeFromStart ?? ""].join(":"))
    .join(";");

function buildRecord(state: RaceState, by: string, officialVersion: number, prevToken: string | null) {
  const at = new Date().toISOString();
  const nonce = randomBytes(16).toString("hex");
  const riders = Object.values(state.riders);
  const lines = [
    FINALIZE_SIGNATURE_VERSION,
    `race=${state.race.uuid}`,
    `name=${state.race.name ?? ""}`,
    `date=${state.race.date ?? ""}`,
    `cats=${Object.keys(state.categories).length}`,
    `riders=${riders.length}`,
    `by=${by}`,
    `at=${at}`,
    `nonce=${nonce}`,
  ];
  if (officialVersion > 1) lines.push(`official=${officialVersion}`, `prev=${prevToken}`);
  lines.push(`data=${digest(riders)}`);
  const payload = lines.join("\n");
  const token = sha256(payload);
  return {
    version: FINALIZE_SIGNATURE_VERSION, algo: "SHA-256" as const, at, by, nonce, payload, token,
    riderCount: riders.length, categoryCount: Object.keys(state.categories).length,
    signature: sign(null, Buffer.from(token), key()).toString("base64"), keyId: env.RESULTS_SIGNING_KEY_ID,
  };
}

/** A server-written Action in the log (close-out, Finalized, Amended). */
async function appendServerEvent(d: Db, raceUuid: string, userId: string, type: string, payload: unknown, heat: number | null): Promise<number> {
  const s = await d.one<{ lastSeq: number }>(`UPDATE races SET "lastSeq" = "lastSeq" + 1 WHERE uuid = $1 RETURNING "lastSeq"`, [raceUuid]);
  await d.query(
    `INSERT INTO race_events ("actionId", "raceUuid", seq, type, payload, heat, "deviceTime", "clockOffsetMs", "eventAt", "deviceId", "protocolVersion", "userId", applied)
     VALUES ($1, $2, $3, $4, $5, $6, now(), 0, now(), 'server', $7, $8, true)`,
    [randomUUID(), raceUuid, s!.lastSeq, type, JSON.stringify(payload), heat, PROTOCOL_VERSION, userId],
  );
  return s!.lastSeq;
}

const emptyCommit = (raceUuid: string): CommittedChanges => ({
  raceUuid, seq: 0, race: false, categories: new Set(), riders: new Set(), removedRiders: [], removedCategories: [], results: [],
});

export const resultsRouter = Router({ mergeParams: true });
resultsRouter.use(requireAuth);
const raceUuidOf = (req: { params: Record<string, unknown> }) => String(req.params.raceUuid);

resultsRouter.get("/results", route(async (req, res) => {
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId, ["results", "view"]);
  const state = await loadState(db, m.raceUuid);
  if (!state) throw raceNotFound();
  const categories = Object.values(state.categories)
    .filter((c) => m.access.waves === null || (c.heat !== null && m.access.waves.includes(c.heat)))
    .filter((c) => m.access.categories === null || m.access.categories.includes(c.uuid))
    .sort((a, b) => (a.heat ?? 0) - (b.heat ?? 0) || (a.importOrder ?? 0) - (b.importOrder ?? 0) || a.name.localeCompare(b.name))
    .map((c) => ({
      category: c,
      riders: Object.values(state.riders)
        .filter((r) => categoryKey(r.category, r.subCategory) === categoryKey(c.name, c.subCategory))
        .sort((a, b) => (a.position_category || 1e9) - (b.position_category || 1e9))
        .map((r) => projectRider(m.access, state, r))
        .filter((r) => r !== null),
    }));
  const official = await db.query(
    `SELECT "officialVersion", at, by, token, reason FROM official_versions WHERE "raceUuid" = $1 ORDER BY "officialVersion"`,
    [m.raceUuid],
  );
  res.json({ lastSeq: state.race.lastSeq, categories, official });
}));

resultsRouter.post("/finalize", route(async (req, res) => {
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId);
  requireOwner(m);
  const me = await loadUser(db, m.userId);
  const commit = emptyCommit(m.raceUuid);
  let finalState: RaceState | null = null;
  const record = await tx(async (d) => {
    const state = await loadState(d, m.raceUuid, true);
    if (!state) throw raceNotFound();
    if (await d.one(`SELECT 1 FROM official_versions WHERE "raceUuid" = $1`, [m.raceUuid])) throw new ApiError(409, "already_official", "The race is already final — amend it instead");
    // Close every open wave first: riders still on track finish on their completed laps (never DNF).
    const heats = [...new Set(Object.values(state.categories).filter((c) => c.status !== "finished").map((c) => c.heat ?? 0))];
    for (const heat of heats) {
      const now = new Date().toISOString();
      const action = { actionId: randomUUID(), raceUuid: m.raceUuid, type: "WaveFinished", payload: { heat }, deviceTime: now, clockOffsetMs: 0, deviceId: "server", protocolVersion: PROTOCOL_VERSION } as RaceAction;
      const r = applyAction(state, action, actionTime(action));
      if (!r.applied) continue;
      const seq = await appendServerEvent(d, m.raceUuid, m.userId, "WaveFinished", { heat }, heat);
      const touched = new Set(r.changes.riders);
      await rederive(d, state, r.changes.rederive, touched);
      await saveChanges(d, state, { race: false, categories: r.changes.categories, riders: touched, removedRiders: [], removedCategories: [] }, seq);
      r.changes.categories.forEach((c) => commit.categories.add(c));
      touched.forEach((x) => commit.riders.add(x));
    }
    const rec = buildRecord(state, me.name || me.email || m.userId, 1, null);
    const seq = await appendServerEvent(d, m.raceUuid, m.userId, "Finalized", { version: 1, token: rec.token }, null);
    state.race.status = "finished";
    await saveChanges(d, state, { race: true, categories: [], riders: [], removedRiders: [], removedCategories: [] }, seq);
    await d.query(
      `INSERT INTO official_versions ("raceUuid", "officialVersion", version, algo, at, by, nonce, payload, token, "riderCount", "categoryCount", "issuedBy", signature, "keyId", "atSeq")
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [m.raceUuid, rec.version, rec.algo, rec.at, rec.by, rec.nonce, rec.payload, rec.token, rec.riderCount, rec.categoryCount, m.userId, rec.signature, rec.keyId, seq],
    );
    commit.seq = seq;
    commit.race = true;
    finalState = state;
    return rec;
  });
  if (finalState) await publishChanges(finalState, commit);
  res.status(201).json({ official: { officialVersion: 1, ...record } });
}));

resultsRouter.post("/amend", route(async (req, res) => {
  const body = z.object({ reason: z.string().trim().min(3).max(500), includeActionIds: z.array(z.string().uuid()).max(1000).default([]) }).parse(req.body);
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId);
  requireOwner(m);
  const me = await loadUser(db, m.userId);
  const commit = emptyCommit(m.raceUuid);
  let finalState: RaceState | null = null;
  const record = await tx(async (d) => {
    const state = await loadState(d, m.raceUuid, true);
    if (!state) throw raceNotFound();
    const prev = await d.one<{ officialVersion: number; token: string }>(
      `SELECT "officialVersion", token FROM official_versions WHERE "raceUuid" = $1 ORDER BY "officialVersion" DESC LIMIT 1 FOR UPDATE`,
      [m.raceUuid],
    );
    if (!prev) throw new ApiError(409, "not_official", "Finalize the race first");
    // Only Actions kept back because the race was official can be included.
    const late = await d.query<RaceAction & { seq: number; eventAtMs: number }>(
      `SELECT "actionId", "raceUuid", type, payload, "deviceTime", "clockOffsetMs", "deviceId", "protocolVersion", seq,
              (extract(epoch FROM "eventAt") * 1000)::bigint AS "eventAtMs"
       FROM race_events WHERE "raceUuid" = $1 AND "actionId" = ANY($2::uuid[]) AND NOT applied AND reason = 'race_official' ORDER BY seq`,
      [m.raceUuid, body.includeActionIds],
    );
    if (late.length !== body.includeActionIds.length) throw new ApiError(400, "invalid", "Only actions held back by the official result can be included");
    const included: string[] = [];
    const rederiveSet = new Set<string>();
    for (const a of late) {
      const action = { ...a, deviceTime: new Date(a.deviceTime as unknown as Date).toISOString() } as RaceAction;
      // A held-back late action keeps its original event time (never its arrival or amendment time).
      const r = applyAction(state, action, Number(a.eventAtMs));
      if (!r.applied) continue;
      included.push(a.actionId);
      r.changes.rederive.forEach((x) => rederiveSet.add(x));
      r.changes.riders.forEach((x) => commit.riders.add(x));
      r.changes.categories.forEach((x) => commit.categories.add(x));
    }
    const nextVersion = prev.officialVersion + 1;
    // The amendment row must exist before re-deriving, so the included laps count.
    const seq = await appendServerEvent(d, m.raceUuid, m.userId, "Amended", { version: nextVersion, prevToken: prev.token, reason: body.reason, includeActionIds: included }, null);
    await d.query(
      `INSERT INTO official_versions ("raceUuid", "officialVersion", version, by, nonce, payload, token, "riderCount", "categoryCount", "issuedBy", signature, "keyId", "atSeq", "prevToken", reason, "includeActionIds")
       VALUES ($1, $2, '', '', '', '', '', 0, 0, $3, '', '', $4, $5, $6, $7)`,
      [m.raceUuid, nextVersion, m.userId, seq, prev.token, body.reason, included],
    );
    const touched = new Set(commit.riders);
    await rederive(d, state, rederiveSet, touched);
    await saveChanges(d, state, { race: false, categories: commit.categories, riders: touched, removedRiders: [], removedCategories: [] }, seq);
    const rec = buildRecord(state, me.name || me.email || m.userId, nextVersion, prev.token);
    await d.query(
      `UPDATE official_versions SET version = $3, at = $4, by = $5, nonce = $6, payload = $7, token = $8, "riderCount" = $9, "categoryCount" = $10, signature = $11, "keyId" = $12
       WHERE "raceUuid" = $1 AND "officialVersion" = $2`,
      [m.raceUuid, nextVersion, rec.version, rec.at, rec.by, rec.nonce, rec.payload, rec.token, rec.riderCount, rec.categoryCount, rec.signature, rec.keyId],
    );
    touched.forEach((x) => commit.riders.add(x));
    commit.seq = seq;
    finalState = state;
    return { officialVersion: nextVersion, prevToken: prev.token, reason: body.reason, includeActionIds: included, ...rec };
  });
  if (finalState) await publishChanges(finalState, commit);
  res.status(201).json({ official: record });
}));

resultsRouter.get("/official", route(async (req, res) => {
  const m = await requireMember(db, raceUuidOf(req), authed(req).userId, ["results", "view"]);
  const versions = await db.query(
    `SELECT "officialVersion", version, algo, at, by, nonce, payload, token, "riderCount", "categoryCount", signature, "keyId", "atSeq", "prevToken", reason, "includeActionIds", "issuedBy"
     FROM official_versions WHERE "raceUuid" = $1 ORDER BY "officialVersion"`,
    [m.raceUuid],
  );
  res.json({ versions, publicKey: versions.length ? publicKeyPem() : null });
}));
