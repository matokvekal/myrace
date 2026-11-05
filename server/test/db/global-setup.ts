/**
 * Database tests: rebuild the schema of the dedicated TEST database from
 * server/sql (001…, never 000) before the run. Only a database whose name ends
 * in "_test" is accepted — production ("commissaire") and every other database
 * are refused before anything is sent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { isTestDatabase } from "../../src/config/testDatabase";
import { migrationFiles } from "../../src/db/migrate";
import { databaseConnection } from "../../src/db/tls";

export async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "";
  if (!isTestDatabase(url)) throw new Error("TEST_DATABASE_URL must name a dedicated database ending in _test (never production)");
  const client = new pg.Client(databaseConnection(url, {
    caCertFile: process.env.DATABASE_CA_CERT_FILE,
    caCert: process.env.DATABASE_CA_CERT,
    servername: process.env.DATABASE_TLS_SERVERNAME,
  }));
  await client.connect();
  const name = (await client.query("SELECT current_database() AS d")).rows[0].d as string;
  if (!/_test$/.test(name)) throw new Error(`refusing to reset database "${name}"`);
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  const dir = join(import.meta.dirname, "../../sql");
  for (const f of migrationFiles()) await client.query(readFileSync(join(dir, f), "utf8"));
  await client.end();
}
