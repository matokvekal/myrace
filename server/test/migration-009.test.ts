/**
 * 009 on a database shaped like production after 001–008, with data: additive,
 * existing rows keep their meaning, re-runnable, no foreign keys.
 * Each case uses its own in-memory PGlite.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkSchema, migrationFiles } from "../src/db/migrate";

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), "utf8");
const upTo = (n: number) => migrationFiles().filter((f) => Number(f.slice(0, 3)) <= n);

async function productionLike() {
  const db = await PGlite.create();
  for (const f of upTo(8)) await db.exec(`BEGIN;\n${sql(f)}\nCOMMIT;`);
  await db.exec(`
    INSERT INTO users (id, email, name) VALUES ('00000000-0000-0000-0000-000000000001', 'o@x.test', 'Owner');
    INSERT INTO races (uuid, "ownerUserId", name) VALUES ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000001', 'Old race');
    INSERT INTO categories (uuid, "raceUuid", name, heat, color) VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000aa', 'Elite', 1, '#E53935');
    INSERT INTO riders (uuid, "raceUuid", "bibNumber", category, "firstName", "lastName") VALUES ('00000000-0000-0000-0000-0000000000r1', '00000000-0000-0000-0000-0000000000aa', 7, 'Elite', 'Test', 'Rider');
  `.replace("0000000000r1", "0000000000e1"));
  return db;
}

describe("migration 009", () => {
  it("adds the columns and table, keeps existing rows and their meaning, re-runs cleanly", async () => {
    const db = await productionLike();
    const before = (await db.query<Record<string, unknown>>(`SELECT * FROM riders`)).rows;
    await db.exec(`BEGIN;\n${sql("009-waves-bibs-laps-preferences.sql")}\nCOMMIT;`);
    await db.exec(`BEGIN;\n${sql("009-waves-bibs-laps-preferences.sql")}\nCOMMIT;`); // idempotent

    const cat = (await db.query<{ ignored: boolean; bibColor: string | null; bibTextColor: string | null; color: string }>(`SELECT ignored, "bibColor", "bibTextColor", color FROM categories`)).rows[0];
    expect(cat).toEqual({ ignored: false, bibColor: null, bibTextColor: null, color: "#E53935" });
    const race = (await db.query<{ minLapSeconds: number | null }>(`SELECT "minLapSeconds" FROM races`)).rows[0];
    expect(race.minLapSeconds).toBeNull(); // existing races keep the 60 s rule
    const riders = (await db.query<Record<string, unknown>>(`SELECT * FROM riders`)).rows;
    expect(riders).toHaveLength(1);
    expect(riders[0]).toMatchObject({ ...before[0], bibColor: null, bibTextColor: null });

    expect(await checkSchema(db)).toEqual({ missingMigrations: [], missingTables: [], foreignKeys: 0 });
    await db.close();
  });

  it("checks the minimum lap range and the preference key format", async () => {
    const db = await productionLike();
    await db.exec(`BEGIN;\n${sql("009-waves-bibs-laps-preferences.sql")}\nCOMMIT;`);
    await expect(db.exec(`UPDATE races SET "minLapSeconds" = 4000`)).rejects.toThrow();
    await db.exec(`UPDATE races SET "minLapSeconds" = 180`);
    await db.exec(`INSERT INTO user_preferences ("userId", key, value) VALUES ('00000000-0000-0000-0000-000000000001', 'finish_groups', '{"groups": []}')`);
    await expect(db.exec(`INSERT INTO user_preferences ("userId", key, value) VALUES ('00000000-0000-0000-0000-000000000001', 'Bad Key!', '{}')`)).rejects.toThrow();
    await db.close();
  });
});
