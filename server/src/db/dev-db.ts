/**
 * Local development database without installing PostgreSQL: PGlite (PostgreSQL
 * compiled to WebAssembly) served on 127.0.0.1:5433 over the normal wire
 * protocol, data kept in server/.pgdata. Migrations run on start.
 *
 *   npm run db:dev   →  COMMISSAIRE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres
 *
 * Development only; production uses the real commissaire_live database.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { fileURLToPath } from "node:url";
import { migrate } from "./migrate.js";

const dataDir = fileURLToPath(new URL("../../.pgdata", import.meta.url));
const port = Number(process.env.DEV_DB_PORT ?? 5433);

const pg = await PGlite.create(dataDir);
const ran = await migrate(
  (sql) => pg.exec(sql),
  async () => {
    const t = await pg.query<{ t: string | null }>("SELECT to_regclass('public.schema_migrations') AS t");
    if (!t.rows[0].t) return new Set();
    return new Set((await pg.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
  },
);
console.log(ran.length ? `Applied migrations: ${ran.join(", ")}` : "Dev database is up to date.");

const server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
await server.start();
console.log(`Dev PostgreSQL (PGlite) on postgresql://postgres:postgres@127.0.0.1:${port}/postgres — Ctrl+C to stop`);

const stop = async () => {
  await server.stop();
  await pg.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
