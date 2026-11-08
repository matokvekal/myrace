/**
 * Guest (no account) read-only access to ONE PUBLISHED race through its share link
 * (/share/<token>). Nothing here writes, and nothing here accepts a race uuid:
 * only a token signed by this server (shareToken.ts). Responses carry public data
 * only (`projectPublicState`: race info, categories/schedule, riders' names, bibs
 * and results — no participant details, members, join code or audit).
 *
 *   GET /public/races/:token              the race (always, also once finished)
 *   GET /public/races/:token/changes      updates after ?afterSeq, ONLY while guest
 *                                         polling is open (guestPolling.ts): closed
 *                                         once the race is finished or 24 h after
 *                                         its scheduled start → 410 polling_closed.
 */
import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "../db/pool.js";
import { ApiError, route } from "../lib/core.js";
import { loadState } from "../races/repo.js";
import { projectPublicState } from "../../../src/shared/race/access.js";
import { GUEST_POLL_INTERVAL_MS, guestPollingEndsAt } from "../../../src/shared/race/guestPolling.js";
import type { RaceState } from "../../../src/shared/race/state.js";
import { raceUuidFromShareToken } from "./shareToken.js";
import { approvalViews } from "../races/approvals.js";

export const publicRouter = Router();
// A guest page polls every 10 s; this leaves room for several open tabs behind one address.
publicRouter.use(rateLimit({ windowMs: 60_000, limit: Number(process.env.PUBLIC_RATE_LIMIT ?? 120), standardHeaders: true, legacyHeaders: false }));
publicRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const linkNotFound = () => new ApiError(404, "not_found", "This race link is not valid");

async function stateOf(token: string): Promise<RaceState> {
  const uuid = raceUuidFromShareToken(token);
  // Only explicitly PUBLISHED, not deleted races are public (migration 010). Unpublish → 404 at once.
  const visible = uuid ? await db.one(`SELECT 1 FROM races WHERE uuid = $1 AND "publishedAt" IS NOT NULL AND "deletedAt" IS NULL`, [uuid]) : null;
  const state = visible ? await loadState(db, uuid!) : null;
  if (!state) throw linkNotFound();
  return state;
}

const polling = (state: RaceState, now = Date.now()) => {
  const endsAt = guestPollingEndsAt(state.race, Object.values(state.categories));
  return { open: now < endsAt, endsAt: endsAt || null, intervalMs: GUEST_POLL_INTERVAL_MS };
};

const send = (res: Response, state: RaceState, body: Record<string, unknown>) =>
  res.json({ lastSeq: state.race.lastSeq, serverTime: Date.now(), polling: polling(state), ...body });

publicRouter.get("/races/:token", route(async (req, res) => {
  const state = await stateOf(String(req.params.token));
  // 0.3.5: only VALID approvals (result unchanged since APPROVED), no judge identity.
  send(res, state, { ...projectPublicState(state), approvals: await approvalViews(db, state, { guest: true }) });
}));

publicRouter.get("/races/:token/changes", route(async (req, res) => {
  const afterSeq = z.coerce.number().int().min(0).parse(req.query.afterSeq ?? 0);
  const state = await stateOf(String(req.params.token));
  if (!polling(state).open) throw new ApiError(410, "polling_closed", "Live updates for this race have ended");
  if (afterSeq >= state.race.lastSeq) return send(res, state, { unchanged: true });
  // Far behind, something removed, or a category edited (it may have been ignored/restored): send the whole public race.
  const removed = await db.one(
    `SELECT 1 FROM race_events WHERE "raceUuid" = $1 AND seq > $2 AND applied AND type IN ('RiderDeleted', 'CategoryDeleted', 'CategoryEdited') LIMIT 1`,
    [state.race.uuid, afterSeq],
  );
  const pub = projectPublicState(state);
  const approvals = await approvalViews(db, state, { guest: true });
  if (removed || state.race.lastSeq - afterSeq > 5000) return send(res, state, { full: true, ...pub, approvals });
  const riders = new Set((await db.query<{ uuid: string }>(`SELECT uuid FROM riders WHERE "raceUuid" = $1 AND "changedSeq" > $2`, [state.race.uuid, afterSeq])).map((r) => r.uuid));
  const cats = new Set((await db.query<{ uuid: string }>(`SELECT uuid FROM categories WHERE "raceUuid" = $1 AND "changedSeq" > $2`, [state.race.uuid, afterSeq])).map((c) => c.uuid));
  send(res, state, {
    race: pub.race,
    categories: pub.categories.filter((c) => cats.has(c.uuid)),
    riders: pub.riders.filter((r) => r.uuid && riders.has(r.uuid)),
    approvals, // always the full list (small): an approval or invalidation changes no category row
  });
}));
