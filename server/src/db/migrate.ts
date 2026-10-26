/**
 * Applies server/sql/NNN-*.sql in order, each in its own transaction, skipping
 * versions already in schema_migrations. 000-create-database.sql (run by hand
 * by a superuser) and verify.sql are never run here.
 *
 * CLI: `npm run migrate` (uses COMMISSAIRE_DATABASE_URL).
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const SQL_DIR = fileURLToPath(new URL("../../sql/", import.meta.url));

export const migrationFiles = () =>
  readdirSync(SQL_DIR)
    .filter((f) => /^\d{3}-.+\.sql$/.test(f) && !f.startsWith("000-"))
    .sort();

/** Runs pending migrations with any client that can execute multi-statement SQL. */
export async function migrate(exec: (sql: string) => Promise<unknown>, applied: () => Promise<Set<string>>): Promise<string[]> {
  const done = await applied();
  const ran: string[] = [];
  for (const file of migrationFiles()) {
    const version = file.replace(/\.sql$/, "");
    if (done.has(version)) continue;
    await exec(`BEGIN;\n${readFileSync(SQL_DIR + file, "utf8")}\nCOMMIT;`);
    ran.push(version);
  }
  return ran;
}

export async function migratePool(pool: pg.Pool): Promise<string[]> {
  return migrate(
    (sql) => pool.query(sql),
    async () => {
      const exists = await pool.query("SELECT to_regclass('public.schema_migrations') AS t");
      if (!exists.rows[0].t) return new Set();
      const rows = await pool.query("SELECT version FROM schema_migrations");
      return new Set(rows.rows.map((r: { version: string }) => r.version));
    },
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { pool, closePool } = await import("./pool.js");
  try {
    const ran = await migratePool(pool);
    console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
  } finally {
    await closePool();
  }
}
