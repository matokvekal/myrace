/**
 * POST /races/:raceUuid/actions — the only write path for shared race data
 * (AD-3). A batch is processed in one transaction under the race row lock, so
 * Race sequences are gap-free and commit in order (AD-6):
 *
 *   validate → idempotency (same actionId returns the stored result) →
 *   authorize against the Server's state → apply with the shared rules engine →
 *   append to race_events (applied or not, with a reason) → save changed rows →
 *   after commit, broadcast each member's filtered view.
 *
 * Race-clock time of a lap = device time + measured clock offset (AD-9),
 * clamped to the server's receive time so a wrong clock cannot date a lap
 * in the future.
 */
import type { Db } from "../db/pool.js";
import { tx } from "../db/pool.js";
import { ApiError, logger } from "../lib/core.js";
import { publishChanges, type CommittedChanges } from "../realtime/socket.js";
import { authorizeAction } from "../../../src/shared/race/access.js";
import { PROTOCOL_VERSION, type RaceAction } from "../../../src/shared/race/actions.js";
import { actionHeat, applyAction, deriveRider, groupRiders, rankRiders } from "../../../src/shared/race/engine.js";
import type { RaceState } from "../../../src/shared/race/state.js";
import { loadMembership, raceNotFound } from "./access.js";
import { loadMarks, loadState, saveChanges } from "./repo.js";
import { envelope, payloadError } from "./schemas.js";

export interface ActionResult {
  actionId: string | null;
  seq: number | null;
  applied: boolean;
  reason: string | null;
}

const FUTURE_TOLERANCE_MS = 5_000;
const MAX_CLOCK_OFFSET_MS = 24 * 3_600_000;

/**
 * The event's time on the server clock (AD-9): device time + measured offset.
 * Never the arrival time, except an event dated after its own arrival, which is
 * held to the arrival time and flagged. An offset beyond +/-24 h is a broken
 * measurement: the device time is used as is, and flagged. Nothing the Device
 * sent is overwritten; the result is stored separately as eventAt.
 */
export function eventTime(a: Pick<RaceAction, "deviceTime" | "clockOffsetMs">, receivedAt: number): { at: number; clockCheck: "future" | "offset_ignored" | null } {
  const device = Date.parse(a.deviceTime);
  let clockCheck: "future" | "offset_ignored" | null = null;
  let at = device + (a.clockOffsetMs || 0);
  if (Math.abs(a.clockOffsetMs || 0) > MAX_CLOCK_OFFSET_MS) {
    at = device;
    clockCheck = "offset_ignored";
  }
  if (at > receivedAt + FUTURE_TOLERANCE_MS) {
    at = receivedAt;
    clockCheck = "future";
  }
  return { at, clockCheck };
}

/** Re-derives riders from their marks; follows first-finish effects through the group. */
export async function rederive(d: Db, state: RaceState, riderUuids: Iterable<string>, touched: Set<string>): Promise<void> {
  let pending = new Set(riderUuids);
  for (let round = 0; round < 3 && pending.size > 0; round++) {
    const marks = await loadMarks(d, state.race.uuid, [...pending]);
    const next = new Set<string>();
    for (const uuid of pending) {
      const before = state.riders[uuid]?.raceStatus;
      if (deriveRider(state, uuid, marks.get(uuid) ?? [])) {
        touched.add(uuid);
        if (state.riders[uuid]?.raceStatus !== before) for (const g of groupRiders(state, uuid)) next.add(g);
      }
    }
    pending = next;
  }
  for (const uuid of rankRiders(state)) touched.add(uuid);
}

/** Appends one row to race_events and advances the race's sequence. */
async function appendEvent(
  d: Db,
  raceUuid: string,
  action: Pick<RaceAction, "actionId" | "type" | "payload" | "deviceTime" | "clockOffsetMs" | "deviceId" | "protocolVersion">,
  userId: string | null,
  heat: number | null,
  applied: boolean,
  reason: string | null,
  time: { at: number; clockCheck: string | null },
): Promise<number> {
  const s = await d.one<{ lastSeq: number }>(`UPDATE races SET "lastSeq" = "lastSeq" + 1 WHERE uuid = $1 RETURNING "lastSeq"`, [raceUuid]);
  await d.query(
    `INSERT INTO race_events ("actionId", "raceUuid", seq, type, payload, heat, "deviceTime", "clockOffsetMs", "eventAt", "clockCheck", "deviceId", "protocolVersion", "userId", applied, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [action.actionId, raceUuid, s!.lastSeq, action.type, JSON.stringify(action.payload ?? {}), heat, action.deviceTime,
      action.clockOffsetMs, new Date(time.at), time.clockCheck, action.deviceId, action.protocolVersion, userId, applied, reason],
  );
  return s!.lastSeq;
}

export const isOfficial = async (d: Db, raceUuid: string) =>
  !!(await d.one(`SELECT 1 FROM official_versions WHERE "raceUuid" = $1`, [raceUuid]));

export async function processActions(raceUuid: string, userId: string, items: unknown[]): Promise<ActionResult[]> {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) throw new ApiError(400, "invalid", "Send 1–100 actions");
  // Protocol versioning (AD-17): N and N-1 only; otherwise nothing is stored and the Device upgrades.
  for (const it of items) {
    const v = (it as { protocolVersion?: unknown })?.protocolVersion;
    if (typeof v === "number" && (v > PROTOCOL_VERSION || v < PROTOCOL_VERSION - 1)) {
      throw new ApiError(426, "upgrade_required", "Update the app to keep syncing");
    }
  }

  const committed: CommittedChanges = {
    raceUuid, seq: 0, race: false, categories: new Set(), riders: new Set(), removedRiders: [], removedCategories: [], results: [],
  };
  let finalState: RaceState | null = null;

  const results = await tx(async (d) => {
    const state = await loadState(d, raceUuid, true);
    // Revoked members may still deliver what they recorded offline: it is kept, not applied (FR-12).
    const m = await loadMembership(d, raceUuid, userId);
    if (!state || !m) throw raceNotFound();
    const official = await isOfficial(d, raceUuid);
    const out: ActionResult[] = [];

    for (const raw of items) {
      const env = envelope.safeParse(raw);
      if (!env.success) {
        out.push({ actionId: (raw as { actionId?: string })?.actionId ?? null, seq: null, applied: false, reason: "invalid" });
        continue;
      }
      const a = env.data as unknown as RaceAction;

      // Idempotency: a re-send returns the stored result, whichever race it was sent to.
      const prior = await d.one<{ raceUuid: string; seq: number; applied: boolean; reason: string | null }>(
        `SELECT "raceUuid", seq, applied, reason FROM race_events WHERE "actionId" = $1`,
        [a.actionId],
      );
      if (prior) {
        out.push(prior.raceUuid === raceUuid
          ? { actionId: a.actionId, seq: prior.seq, applied: prior.applied, reason: prior.reason }
          : { actionId: a.actionId, seq: null, applied: false, reason: "invalid" });
        continue;
      }

      let reason: string | null = null;
      if (a.raceUuid !== raceUuid || payloadError(a.type, a.payload)) reason = "invalid";
      else if (m.revoked) reason = "not_member";
      else if (official) reason = "race_official";

      let targets: Record<string, RaceAction> | undefined;
      if (!reason && a.type === "Undo") {
        const t = await d.one<{ actionId: string; raceUuid: string; type: string; payload: unknown; applied: boolean }>(
          `SELECT "actionId", "raceUuid", type, payload, applied FROM race_events WHERE "actionId" = $1`,
          [a.payload.targetActionId],
        );
        const alreadyUndone = await d.one(
          `SELECT 1 FROM race_events WHERE "raceUuid" = $1 AND type = 'Undo' AND applied AND payload->>'targetActionId' = $2`,
          [raceUuid, a.payload.targetActionId],
        );
        // Undo reverses exactly its target: an applied AddLap/RiderFinished of this race, once.
        if (!t || t.raceUuid !== raceUuid || !t.applied || !["AddLap", "RiderFinished"].includes(t.type) || alreadyUndone) reason = "invalid";
        else targets = { [t.actionId]: { ...a, actionId: t.actionId, type: t.type, payload: t.payload } as RaceAction };
      }
      if (!reason) {
        const auth = authorizeAction(m.access, a, state, targets);
        if (!auth.ok) reason = auth.reason;
      }

      const heat = reason === "invalid" ? null : actionHeat(state, a);
      const time = eventTime(a, Date.now());
      if (reason) {
        const seq = await appendEvent(d, raceUuid, a, userId, heat, false, reason, time);
        out.push({ actionId: a.actionId, seq, applied: false, reason });
        committed.results.push({ actionId: a.actionId, seq, applied: false, reason, userId });
        committed.seq = seq;
        continue;
      }

      const applied = applyAction(state, a, time.at);
      if (!applied.applied) {
        const seq = await appendEvent(d, raceUuid, a, userId, heat, false, applied.reason, time);
        out.push({ actionId: a.actionId, seq, applied: false, reason: applied.reason });
        committed.results.push({ actionId: a.actionId, seq, applied: false, reason: applied.reason, userId });
        committed.seq = seq;
        continue;
      }

      const seq = await appendEvent(d, raceUuid, a, userId, heat, true, null, time);
      const ch = applied.changes;
      const touched = new Set<string>(ch.riders);
      const toDerive = new Set(ch.rederive);
      if (a.type === "Undo" && targets) {
        const target = Object.values(targets)[0];
        const riderUuid = (target.payload as { riderUuid?: string }).riderUuid;
        if (riderUuid) toDerive.add(riderUuid);
      }
      await rederive(d, state, toDerive, touched);
      await saveChanges(d, state, { race: ch.race, categories: ch.categories, riders: touched, removedRiders: ch.removedRiders, removedCategories: ch.removedCategories }, seq);

      out.push({ actionId: a.actionId, seq, applied: true, reason: null });
      committed.results.push({ actionId: a.actionId, seq, applied: true, reason: null, userId });
      committed.seq = seq;
      committed.race ||= ch.race;
      ch.categories.forEach((c) => committed.categories.add(c));
      touched.forEach((r) => committed.riders.add(r));
      committed.removedRiders.push(...ch.removedRiders);
      committed.removedCategories.push(...ch.removedCategories);
    }
    finalState = state;
    return out;
  });

  if (finalState && committed.seq > 0) {
    publishChanges(finalState, committed).catch((err) => logger.error({ err, raceUuid }, "broadcast failed"));
  }
  return results;
}
