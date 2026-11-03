/**
 * Schema checks for the cloud PostgreSQL database. Code never migrates it: the
 * files in server/sql (NNN-*.sql, applied in order, each in its own transaction)
 * are run by hand with psql. Code only reads schema_migrations, names the files
 * still missing (missingMigrations) and checks the required tables (checkSchema).
 * 000-create-database.sql (superuser, by hand) and verify.sql are never counted.
 *
 * Command line: src/db/migrate-cli.ts (`npm run migrate`, `npm run check:schema`).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { serverRoot } from "../lib/paths.js";

const SQL_DIR = join(serverRoot(import.meta.url), "sql") + "/";

export const migrationFiles = () =>
  readdirSync(SQL_DIR)
    .filter((f) => /^\d{3}-.+\.sql$/.test(f) && !f.startsWith("000-"))
    .sort();

/** Anything that runs a query and returns rows (a pg Pool). */
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

/** Every table the API uses (001–005, 009). schema_migrations alone is no proof: a file can be recorded without its tables. */
export const REQUIRED_TABLES = [
  "schema_migrations", "users", "user_identities", "sessions", "otp_codes",
  "races", "categories", "riders",
  "invitations", "race_members", "contact_groups", "contacts", "contact_group_members",
  "race_events", "race_snapshots", "sync_cursors", "official_versions",
  "user_preferences", // 009
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
