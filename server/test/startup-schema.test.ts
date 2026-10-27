/**
 * The API's startup schema check (checkSchema) looks at the tables that exist,
 * not only at schema_migrations: a migration recorded without its tables (as
 * found on a cloud database before 008) must stop the API.
 * Each case uses its own in-memory PGlite.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkSchema, migrate, migrationFiles, REQUIRED_TABLES } from "../src/db/migrate";

const sql = (f: string) => readFileSync(new URL(`../sql/${f}`, import.meta.url), "utf8");

describe("startup schema check", () => {
  it("passes on a fully migrated database: nothing missing, no foreign keys", async () => {
    const db = await PGlite.create();
    await migrate((s) => db.exec(s), async () => new Set());
    expect(await checkSchema(db)).toEqual({ missingMigrations: [], missingTables: [], foreignKeys: 0 });
    await db.close();
  });

  it("names the tables missing although their migrations are recorded", async () => {
    const db = await PGlite.create();
    await db.exec(`BEGIN;\n${sql("001-users-auth.sql")}\nCOMMIT;`);
    // Every file recorded, but only the 001 tables exist.
    for (const f of migrationFiles()) await db.query("INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING", [f.replace(/\.sql$/, "")]);
    const r = await checkSchema(db);
    expect(r.missingMigrations).toEqual([]);
    expect(r.missingTables).toEqual(REQUIRED_TABLES.filter((t) => !["schema_migrations", "users", "user_identities", "sessions", "otp_codes"].includes(t)).sort());
    expect(r.foreignKeys).toBe(3); // 001's, before 006/008

    // 008 repairs 001–007; 009 (run after it, as in production) adds its own table.
    await db.exec(sql("008-recover-missing-schema.sql"));
    await db.exec(`BEGIN;
${sql("009-waves-bibs-laps-preferences.sql")}
COMMIT;`);
    expect(await checkSchema(db)).toEqual({ missingMigrations: [], missingTables: [], foreignKeys: 0 });
    await db.close();
  });

  it("names unrecorded migration files on an empty database", async () => {
    const db = await PGlite.create();
    const r = await checkSchema(db);
    expect(r.missingMigrations).toEqual(migrationFiles());
    expect(r.missingTables).toEqual([...REQUIRED_TABLES].sort());
    await db.close();
  });
});
