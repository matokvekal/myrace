/**
 * Applies server/sql/NNN-*.sql in order, each in its own transaction, skipping
 * versions already in schema_migrations. 000-create-database.sql (run by hand
 * by a superuser) and verify.sql are never run here.
 *
 * Only the local PGlite dev database is ever migrated by code (`npm run db:dev`,
 * the test setup, and the API when autoMigrateAllowed()). A cloud/external
 * database is migrated by hand with psql; code only reads schema_migrations
 * and names the files still missing (missingMigrations).
 *
 * CLI: `npm run migrate` — migrates the local PGlite dev database; on any other
 * database it only lists the missing files and exits 1 if there are any.
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

/** Anything that runs a query and returns rows: a pg Pool, or PGlite in tests. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}
type Rows<T> = { rows: T[] };

/** Read-only: the migration files (e.g. "004-race-events.sql") not yet recorded in schema_migrations. */
export async function missingMigrations(pool: Queryable): Promise<string[]> {
  const exists = (await pool.query("SELECT to_regclass('public.schema_migrations') AS t")) as Rows<{ t: string | null }>;
  const done = exists.rows[0].t
    ? new Set(((await pool.query("SELECT version FROM schema_migrations")) as Rows<{ version: string }>).rows.map((r) => r.version))
    : new Set<string>();
  return migrationFiles().filter((f) => !done.has(f.replace(/\.sql$/, "")));
}

/** Every table the API uses (001–005). schema_migrations alone is no proof: a file can be recorded without its tables. */
export const REQUIRED_TABLES = [
  "schema_migrations", "users", "user_identities", "sessions", "otp_codes",
  "races", "categories", "riders",
  "invitations", "race_members", "contact_groups", "contacts", "contact_group_members",
  "race_events", "race_snapshots", "sync_cursors", "official_versions",
];

/**
 * Read-only startup check of the schema that actually exists: migration files
 * not recorded, required tables missing, and foreign keys (policy: none).
 */
export async function checkSchema(pool: Queryable): Promise<{ missingMigrations: string[]; missingTables: string[]; foreignKeys: number }> {
  const tables = (await pool.query(
    "SELECT t FROM unnest($1::text[]) AS t WHERE to_regclass(format('public.%I', t)) IS NULL ORDER BY t",
    [REQUIRED_TABLES],
  )) as Rows<{ t: string }>;
  const fks = (await pool.query(
    "SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace",
  )) as Rows<{ n: number }>;
  return { missingMigrations: await missingMigrations(pool), missingTables: tables.rows.map((r) => r.t), foreignKeys: fks.rows[0].n };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { pool, closePool, autoMigrateAllowed } = await import("./pool.js");
  try {
    if (autoMigrateAllowed()) {
      const ran = await migratePool(pool);
      console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Database is up to date.");
    } else {
      const missing = await missingMigrations(pool);
      if (missing.length) {
        console.log(`Not applied (run by hand, in this order, with psql -1 -v ON_ERROR_STOP=1 -f):\n  ${missing.join("\n  ")}`);
        process.exitCode = 1;
      } else console.log("All migrations are applied.");
    }
  } finally {
    await closePool();
  }
}
