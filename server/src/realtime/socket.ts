/**
 * Socket.IO, server → client only (AD-8): a Device joins the races it may see
 * and receives committed changes, each one filtered for that member (hidden
 * waves, out-of-scope riders, lap data and private details are never sent).
 * Writes go through POST /races/:raceUuid/actions, never through the socket.
 *
 * Client → server events: "join" {raceUuid}, "leave" {raceUuid}, "time" (clock
 * offset). Server → client: "race:changes", "race:access", "race:revoked".
 */
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { env } from "../config/env.js";
import { db } from "../db/pool.js";
import { logger } from "../lib/core.js";
import { verifyAccessToken } from "../auth/tokens.js";
import { accessSummary, canSeeAnything, loadMembership, type Membership } from "../races/access.js";
import { projectCategory, projectRace, projectRider } from "../../../src/shared/race/access.js";
import type { RaceState } from "../../../src/shared/race/state.js";

let io: Server | null = null;

interface SocketData {
  userId: string;
  sessionId: string;
  races: Map<string, Membership>;
}
const dataOf = (s: Socket) => s.data as SocketData;
const room = (raceUuid: string) => `race:${raceUuid}`;

export function attachRealtime(http: HttpServer): Server {
  io = new Server(http, {
    cors: { origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : true, credentials: true },
    serveClient: false,
  });
  const ns = io.of("/race");

  ns.use(async (socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token ?? "");
      const claims = await verifyAccessToken(token);
      const live = await db.one(`SELECT 1 FROM sessions WHERE id = $1 AND "revokedAt" IS NULL`, [claims.sessionId]);
      if (!live) throw new Error("session");
      Object.assign(socket.data, { userId: claims.userId, sessionId: claims.sessionId, races: new Map() } satisfies SocketData);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  ns.on("connection", (socket) => {
    socket.on("join", async (msg: { raceUuid?: string }, ack?: (r: unknown) => void) => {
      const raceUuid = String(msg?.raceUuid ?? "");
      const m = await loadMembership(db, raceUuid, dataOf(socket).userId).catch(() => null);
      if (!m || m.revoked || !canSeeAnything(m.access)) return ack?.({ ok: false, error: "not_member" });
      dataOf(socket).races.set(raceUuid, m);
      await socket.join(room(raceUuid));
      const last = await db.one<{ lastSeq: number }>(`SELECT "lastSeq" FROM races WHERE uuid = $1`, [raceUuid]);
      ack?.({ ok: true, lastSeq: last?.lastSeq ?? 0, access: accessSummary(m) });
    });

    socket.on("leave", async (msg: { raceUuid?: string }, ack?: (r: unknown) => void) => {
      const raceUuid = String(msg?.raceUuid ?? "");
      dataOf(socket).races.delete(raceUuid);
      await socket.leave(room(raceUuid));
      ack?.({ ok: true });
    });

    // Clock alignment (AD-9): the Device measures its offset to the server clock.
    socket.on("time", (_msg: unknown, ack?: (r: unknown) => void) => ack?.({ now: Date.now() }));
  });
  return io;
}

export interface CommittedChanges {
  raceUuid: string;
  seq: number;
  race: boolean;
  categories: Set<string>;
  riders: Set<string>;
  removedRiders: string[];
  removedCategories: string[];
  /** Results of the Actions in this commit, delivered to their authors only. */
  results: { actionId: string; seq: number; applied: boolean; reason: string | null; userId: string }[];
}

/** Sends a commit to every joined member, filtered by that member's access. */
export async function publishChanges(state: RaceState, ch: CommittedChanges): Promise<void> {
  if (!io) return;
  const sockets = await io.of("/race").in(room(ch.raceUuid)).fetchSockets();
  for (const s of sockets) {
    const data = s.data as SocketData;
    const m = data.races?.get(ch.raceUuid);
    if (!m) continue;
    const a = m.access;
    const riders: unknown[] = [];
    const hiddenRiders: string[] = [];
    for (const uuid of ch.riders) {
      const r = state.riders[uuid];
      const p = r ? projectRider(a, state, r) : null;
      if (p) riders.push(p);
      else hiddenRiders.push(uuid); // moved out of this member's scope: drop it on the Device
    }
    const categories: unknown[] = [];
    for (const uuid of ch.categories) {
      const c = state.categories[uuid];
      const p = c ? projectCategory(a, c) : null;
      if (p) categories.push(p);
    }
    s.emit("race:changes", {
      raceUuid: ch.raceUuid,
      seq: ch.seq,
      race: ch.race ? projectRace(a, state.race) : undefined,
      categories,
      riders,
      removedRiders: [...ch.removedRiders, ...hiddenRiders],
      removedCategories: ch.removedCategories,
      results: ch.results.filter((r) => r.userId === data.userId).map(({ userId: _u, ...r }) => r),
    });
  }
}

/**
 * A member's access changed (roles, permissions, scope, revoke): update their
 * open sockets at once, and remove them from the room when they may no longer see it.
 */
export async function refreshMemberSockets(raceUuid: string, userId: string): Promise<void> {
  if (!io) return;
  const sockets = await io.of("/race").in(room(raceUuid)).fetchSockets();
  const m = await loadMembership(db, raceUuid, userId);
  for (const s of sockets) {
    const data = s.data as SocketData;
    if (data.userId !== userId) continue;
    if (!m || m.revoked || !canSeeAnything(m.access)) {
      data.races.delete(raceUuid);
      s.leave(room(raceUuid));
      s.emit("race:revoked", { raceUuid });
      continue;
    }
    data.races.set(raceUuid, m);
    s.emit("race:access", { raceUuid, access: accessSummary(m) });
  }
  logger.info({ raceUuid, userId }, "member sockets refreshed");
}

/** The race was deleted: every Device drops it. */
export async function closeRace(raceUuid: string): Promise<void> {
  if (!io) return;
  io.of("/race").to(room(raceUuid)).emit("race:revoked", { raceUuid, deleted: true });
  io.of("/race").in(room(raceUuid)).socketsLeave(room(raceUuid));
}

export const closeRealtime = () => new Promise<void>((resolve) => (io ? io.close(() => resolve()) : resolve()));
