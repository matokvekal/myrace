import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "../lib/core.js";
import { databaseConnection, isLocal } from "./tls.js";

export { isLocal };

// bigint (seq, epoch ms) as JS numbers: they stay far below 2^53.
pg.types.setTypeParser(20, (v: string) => Number(v));

// A non-local database always uses verified TLS (src/db/tls.ts).
const { connectionString, ssl } = databaseConnection(env.DATABASE_URL, {
  caCert: env.DATABASE_CA_CERT,
  caCertFile: env.DATABASE_CA_CERT_FILE,
  servername: env.DATABASE_TLS_SERVERNAME,
});

export const pool = new pg.Pool({
  connectionString,
  options: "-c timezone=UTC",
  ssl,
  max: Number(process.env.DB_POOL_MAX ?? 10),
});
pool.on("error", (err) => logger.error({ err }, "idle database client error"));

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
  one<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T | null>;
}

const wrap = (run: (text: string, params?: unknown[]) => Promise<pg.QueryResult>): Db => ({
  async query<T>(text: string, params?: readonly unknown[]) {
    return (await run(text, params as unknown[])).rows as T[];
  },
  async one<T>(text: string, params?: readonly unknown[]) {
    return ((await run(text, params as unknown[])).rows[0] as T) ?? null;
  },
});

/** Queries outside a transaction. Always pass values as $1, $2 — never inline them. */
export const db: Db = wrap((text, params) => pool.query(text, params));

/** Runs `fn` in BEGIN/COMMIT on one connection; rolls back on any throw. */
export async function tx<T>(fn: (t: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(wrap((text, params) => client.query(text, params)));
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const closePool = () => pool.end();

/** The API may run migrations only on the local PGlite dev database: DEV_PGLITE=true and a loopback host. */
export const autoMigrateAllowed = () => env.DEV_PGLITE && isLocal(env.DATABASE_URL);
