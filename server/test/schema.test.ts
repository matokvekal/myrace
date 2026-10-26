/** The migrations against a real PostgreSQL engine: verify.sql checks and key constraints. */
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { closePool, db } from "../src/db/pool";

afterAll(closePool);

const verify = readFileSync(new URL("../sql/verify.sql", import.meta.url), "utf8").split(/\n(?=-- \d\.)/).slice(1, 6);

describe("schema", () => {
  it("all migrations applied", async () => {
    const rows = await db.query<{ version: string }>(verify[0]);
    expect(rows.map((r) => r.version)).toEqual(["001-users-auth", "002-races", "003-members-invitations-contacts", "004-race-events", "005-official-results"]);
  });

  it("every table exists", async () => {
    const rows = await db.query<{ missing: boolean }>(verify[1]);
    expect(rows).toHaveLength(17);
    expect(rows.every((r) => !r.missing)).toBe(true);
  });

  it("no national ID, passport or free-form extra columns", async () => {
    expect(await db.query(verify[2])).toEqual([]);
  });

  it("every race-data table has a NOT NULL raceUuid referencing races", async () => {
    const rows = await db.query<{ nullable: string; references_races: boolean }>(verify[3]);
    expect(rows.length).toBe(8);
    expect(rows.every((r) => r.nullable === "NO" && r.references_races)).toBe(true);
  });

  it("no triggers or stored functions", async () => {
    expect(await db.query(verify[4])).toEqual([{ triggers: 0, functions: 0 }]);
  });

  it("race_events keeps the device time, the event time and the server arrival time", async () => {
    const cols = await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'race_events'`);
    expect(cols.map((c) => c.column_name)).toEqual(expect.arrayContaining(["deviceTime", "clockOffsetMs", "eventAt", "clockCheck", "serverReceivedAt"]));
  });
});
