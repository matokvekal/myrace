import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "../lib/core.js";

// bigint (seq, epoch ms) as JS numbers: they stay far below 2^53.
pg.types.setTypeParser(20, (v: string) => Number(v));

const isLocal = (url: string) => {
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

export const pool = new pg.Pool({
  connectionString: env.COMMISSAIRE_DATABASE_URL,
  options: "-c timezone=UTC",
  ssl: isLocal(env.COMMISSAIRE_DATABASE_URL) ? false : { rejectUnauthorized: false },
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
