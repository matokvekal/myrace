/**
 * Server-written entries in the race's action log (race_events) — the race's ONE audit
 * trail. Used for changes that don't come from a Device: membership (MemberChanged) and
 * owner/admin operations (RaceAdmin: transfer, publish, delete, invitations, member writes).
 *
 * Call inside the same transaction as the change it records, so both commit or neither.
 * Never put tokens, link secrets or join codes in a payload.
 */
import { randomUUID } from "node:crypto";
import { db, type Db } from "../db/pool.js";
import { PROTOCOL_VERSION, type ActionPayloads } from "../../../src/shared/race/actions.js";
import { publishChanges } from "../realtime/socket.js";
import { raceNotFound } from "./access.js";
import { loadState } from "./repo.js";

type ServerEventType = "MemberChanged" | "RaceAdmin";

/** Appends one server-written, applied entry; returns its seq. Throws 404 if the race is gone. */
export async function logServerEvent<T extends ServerEventType>(
  d: Db,
  raceUuid: string,
  actorId: string,
  type: T,
  payload: ActionPayloads[T],
): Promise<number> {
  const s = await d.one<{ lastSeq: number }>(`UPDATE races SET "lastSeq" = "lastSeq" + 1 WHERE uuid = $1 RETURNING "lastSeq"`, [raceUuid]);
  if (!s) throw raceNotFound(); // deleted meanwhile: the caller's transaction rolls back
  await d.query(
    `INSERT INTO race_events ("actionId", "raceUuid", seq, type, payload, heat, "deviceTime", "clockOffsetMs", "eventAt", "deviceId", "protocolVersion", "userId", applied)
     VALUES ($1, $2, $3, $4, $5, NULL, now(), 0, now(), 'server', $6, $7, true)`,
    [randomUUID(), raceUuid, s.lastSeq, type, JSON.stringify(payload), PROTOCOL_VERSION, actorId],
  );
  return s.lastSeq;
}

/** Advance every Device's cursor past a server-written entry (it carries no race data). */
export async function announceSeq(raceUuid: string, seq: number): Promise<void> {
  const state = await loadState(db, raceUuid);
  if (state) {
    await publishChanges(state, { raceUuid, seq, race: false, categories: new Set(), riders: new Set(), removedRiders: [], removedCategories: [], results: [] });
  }
}
