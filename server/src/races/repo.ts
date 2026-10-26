/**
 * Race state in PostgreSQL: load the whole race (race + categories + riders)
 * for the rules engine, load riders' lap marks from race_events, and write back
 * the rows an Action changed. Every query is scoped by "raceUuid".
 */
import type { Db } from "../db/pool.js";
import type { RiderMark } from "../../../src/shared/race/engine.js";
import type { RaceState, SharedCategory, SharedRace, SharedRider } from "../../../src/shared/race/state.js";

export const RACE_COLUMNS = [
  "uuid", "ownerUserId", "raceId", "owner", "name", "location", "time", "date", "image", "heat", "status", "type",
  "raceType", "level", "orgenizer", "manager", "phone", "takanon", "site", "map", "distance", "isActive",
  "autoColor", "leaderFinishAll", "waveColors", "mapCenter", "mapZoom", "trackPoints", "mapMarkers", "tracks",
  "joinCode", "lastSeq", "createdAt", "lastUpdateAt",
] as const;

export const CATEGORY_COLUMNS = [
  "uuid", "raceUuid", "name", "subCategory", "laps", "startTime", "isConnected", "color", "heat", "status",
  "linkedFinish", "linkGroup", "startedAt", "finishedAt", "importOrder",
] as const;

export const RIDER_COLUMNS = [
  "uuid", "raceUuid", "bibNumber", "category", "subCategory", "checked", "firstName", "middleName", "lastName",
  "flag", "team", "standing", "heat", "status", "comment", "image", "chipNumber", "points", "uciPoints",
  "federation", "uciNumber", "viewOrder", "raceStatus", "timeStartRace", "timeArrive", "lapsCounter", "lapsDetails",
  "totalLaps", "elapsedLastLap", "elapsedTimeFromStart", "distance", "position_start", "position_category",
  "position_race", "color", "createdAt", "updatedAt",
] as const;

const JSON_COLUMNS = new Set(["waveColors", "mapCenter", "trackPoints", "mapMarkers", "tracks", "lapsDetails"]);
const q = (c: string) => `"${c}"`;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

const toRace = (row: Record<string, unknown>): SharedRace =>
  ({ ...row, createdAt: iso(row.createdAt), lastUpdateAt: iso(row.lastUpdateAt) }) as SharedRace;
const toCategory = (row: Record<string, unknown>): SharedCategory => row as unknown as SharedCategory;
const toRider = (row: Record<string, unknown>): SharedRider =>
  ({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }) as SharedRider;

/** Loads a race's full state. `lock` takes the race row lock that serializes writes (AD-6). */
export async function loadState(d: Db, raceUuid: string, lock = false): Promise<RaceState | null> {
  const race = await d.one(
    `SELECT ${RACE_COLUMNS.map(q).join(", ")} FROM races WHERE uuid = $1${lock ? " FOR UPDATE" : ""}`,
    [raceUuid],
  );
  if (!race) return null;
  const cats = await d.query(`SELECT ${CATEGORY_COLUMNS.map(q).join(", ")} FROM categories WHERE "raceUuid" = $1`, [raceUuid]);
  const riders = await d.query(`SELECT ${RIDER_COLUMNS.map(q).join(", ")} FROM riders WHERE "raceUuid" = $1`, [raceUuid]);
  return {
    race: toRace(race),
    categories: Object.fromEntries(cats.map((c) => [c.uuid as string, toCategory(c)])),
    riders: Object.fromEntries(riders.map((r) => [r.uuid as string, toRider(r)])),
  };
}

/** Actions an official amendment accepted after the race was finalized (AD-13). */
const AMENDED_IDS = `SELECT unnest("includeActionIds") FROM official_versions WHERE "raceUuid" = $1`;

/** Applied (or amendment-accepted) lap marks of these riders, with undone marks flagged. */
export async function loadMarks(d: Db, raceUuid: string, riderUuids: string[]): Promise<Map<string, RiderMark[]>> {
  const out = new Map<string, RiderMark[]>(riderUuids.map((u) => [u, []]));
  if (riderUuids.length === 0) return out;
  const rows = await d.query<{ actionId: string; seq: number; type: RiderMark["type"]; riderUuid: string; laps: number | null; at: number }>(
    `SELECT "actionId", seq, type, payload->>'riderUuid' AS "riderUuid", (payload->>'laps')::int AS laps,
            (extract(epoch FROM "deviceTime") * 1000)::bigint + "clockOffsetMs" AS at
     FROM race_events
     WHERE "raceUuid" = $1 AND type IN ('AddLap', 'RiderFinished', 'LapCountCorrection')
       AND payload->>'riderUuid' = ANY($2::text[])
       AND (applied OR "actionId" IN (${AMENDED_IDS}))`,
    [raceUuid, riderUuids],
  );
  const undone = new Set(
    (
      await d.query<{ target: string }>(
        `SELECT payload->>'targetActionId' AS target FROM race_events
         WHERE "raceUuid" = $1 AND type = 'Undo' AND (applied OR "actionId" IN (${AMENDED_IDS}))`,
        [raceUuid],
      )
    ).map((r) => r.target),
  );
  for (const r of rows) {
    out.get(r.riderUuid)?.push({
      actionId: r.actionId, seq: r.seq, type: r.type, at: Number(r.at), laps: r.laps ?? undefined, undone: undone.has(r.actionId),
    });
  }
  return out;
}

const upsert = async (d: Db, table: string, columns: readonly string[], row: Record<string, unknown>, seq: number) => {
  const cols = [...columns, "changedSeq"];
  const values = cols.map((c) => (c === "changedSeq" ? seq : JSON_COLUMNS.has(c) && row[c] != null ? JSON.stringify(row[c]) : row[c] ?? null));
  const updates = cols.filter((c) => c !== "uuid").map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(", ");
  await d.query(
    `INSERT INTO ${table} (${cols.map(q).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
     ON CONFLICT (uuid) DO UPDATE SET ${updates}`,
    values,
  );
};

export interface RowChanges {
  race: boolean;
  categories: Iterable<string>;
  riders: Iterable<string>;
  removedRiders: string[];
  removedCategories: string[];
}

/** Writes the changed rows, stamping them with the sequence that changed them. */
export async function saveChanges(d: Db, state: RaceState, ch: RowChanges, seq: number): Promise<void> {
  for (const uuid of ch.removedRiders) await d.query(`DELETE FROM riders WHERE "raceUuid" = $1 AND uuid = $2`, [state.race.uuid, uuid]);
  for (const uuid of ch.removedCategories) await d.query(`DELETE FROM categories WHERE "raceUuid" = $1 AND uuid = $2`, [state.race.uuid, uuid]);
  for (const uuid of ch.categories) {
    const c = state.categories[uuid];
    if (c) await upsert(d, "categories", CATEGORY_COLUMNS, c as unknown as Record<string, unknown>, seq);
  }
  for (const uuid of ch.riders) {
    const r = state.riders[uuid];
    if (r) await upsert(d, "riders", RIDER_COLUMNS, r as unknown as Record<string, unknown>, seq);
  }
  if (ch.race) {
    const r = state.race as unknown as Record<string, unknown>;
    const cols = RACE_COLUMNS.filter((c) => !["uuid", "ownerUserId", "createdAt", "lastSeq", "joinCode"].includes(c));
    await d.query(
      `UPDATE races SET ${cols.map((c, i) => `${q(c)} = $${i + 2}`).join(", ")}, "changedSeq" = $${cols.length + 2} WHERE uuid = $1`,
      [state.race.uuid, ...cols.map((c) => (JSON_COLUMNS.has(c) && r[c] != null ? JSON.stringify(r[c]) : r[c] ?? null)), seq],
    );
  }
}

/** Inserts a whole race (Publish / create). */
export async function insertRace(d: Db, state: RaceState): Promise<void> {
  const r = state.race as unknown as Record<string, unknown>;
  const cols = RACE_COLUMNS.filter((c) => c !== "lastSeq");
  await d.query(
    `INSERT INTO races (${cols.map(q).join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
    cols.map((c) => (JSON_COLUMNS.has(c) && r[c] != null ? JSON.stringify(r[c]) : r[c] ?? null)),
  );
  for (const c of Object.values(state.categories)) await upsert(d, "categories", CATEGORY_COLUMNS, c as unknown as Record<string, unknown>, 0);
  for (const x of Object.values(state.riders)) await upsert(d, "riders", RIDER_COLUMNS, x as unknown as Record<string, unknown>, 0);
}
