/** The migrations against a real PostgreSQL engine: verify.sql checks and key constraints. */
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { closePool, db } from "../src/db/pool";

afterAll(closePool);

const verify = readFileSync(new URL("../sql/verify.sql", import.meta.url), "utf8").split(/\n(?=-- \d\.)/).slice(1); // checks 1…7

describe("schema", () => {
  it("all migrations applied", async () => {
    const rows = await db.query<{ version: string }>(verify[0]);
    expect(rows.map((r) => r.version)).toEqual([
      "001-users-auth", "002-races", "003-members-invitations-contacts", "004-race-events", "005-official-results",
      "006-remove-foreign-keys", "007-add-basic-indexes", "008-recover-missing-schema", "009-waves-bibs-laps-preferences",
    ]);
  });

  it("every table exists", async () => {
    const rows = await db.query<{ missing: boolean }>(verify[1]);
    expect(rows).toHaveLength(18);
    expect(rows.every((r) => !r.missing)).toBe(true);
  });

  it("no national ID, passport or free-form extra columns", async () => {
    expect(await db.query(verify[2])).toEqual([]);
  });

  it("every race-data table has a NOT NULL, indexed raceUuid", async () => {
    const rows = await db.query<{ nullable: string; indexed: boolean }>(verify[3]);
    expect(rows.length).toBe(8);
    expect(rows.every((r) => r.nullable === "NO" && r.indexed)).toBe(true);
  });

  it("no foreign keys: tables are independent (006), and no later migration adds one", async () => {
    expect(await db.query(verify[6])).toEqual([{ foreign_keys: 0 }]);
  });

  it("the Undo lookup has its index (007)", async () => {
    expect(await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'race_events_undo_target_idx'`)).toHaveLength(1);
  });

  it("future migrations stay free of foreign keys (no REFERENCES after 005)", async () => {
    const { migrationFiles } = await import("../src/db/migrate");
    const later = migrationFiles().filter((f) => Number(f.slice(0, 3)) > 5);
    for (const f of later) {
      const sql = readFileSync(new URL(`../sql/${f}`, import.meta.url), "utf8").replace(/--.*$/gm, "");
      expect(sql, f).not.toMatch(/\bREFERENCES\b|FOREIGN\s+KEY/i);
    }
  });

  it("no triggers or stored functions", async () => {
    expect(await db.query(verify[4])).toEqual([{ triggers: 0, functions: 0 }]);
  });

  it("race_events keeps the device time, the event time and the server arrival time", async () => {
    const cols = await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'race_events'`);
    expect(cols.map((c) => c.column_name)).toEqual(expect.arrayContaining(["deviceTime", "clockOffsetMs", "eventAt", "clockCheck", "serverReceivedAt"]));
  });
});
