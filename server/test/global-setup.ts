/**
 * Starts one in-memory PostgreSQL (PGlite, served over the normal wire
 * protocol) for the whole run and applies the migrations, so the server's real
 * `pg` code paths are what the tests exercise. No external database is touched.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createServer, type AddressInfo } from "node:net";
import { migrate } from "../src/db/migrate";

let server: PGLiteSocketServer | null = null;
let db: PGlite | null = null;

export async function setup() {
  db = await PGlite.create();
  await migrate(
    (sql) => db!.exec(sql),
    async () => new Set(),
  );
  // A free port from the OS (Windows reserves ranges that a guessed port can hit).
  const port = await new Promise<number>((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const p = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(p));
    });
  });
  server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();
  process.env.COMMISSAIRE_SKIP_DOTENV = "1"; // never read server/.env: tests use only this database
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  process.env.DB_POOL_MAX = "1";
  process.env.NODE_ENV = "test";
  process.env.JWT_ACCESS_SECRET = "test-secret-test-secret-test-secret-123";
  process.env.MAIL_TRANSPORT = "log";
  process.env.SMS_ENABLED = "false";
  process.env.APP_URL = "http://app.test";
  process.env.GOOGLE_CLIENT_IDS = "test-client";
  process.env.AUTH_RATE_LIMIT = "10000";
}

export async function teardown() {
  await server?.stop();
  await db?.close();
}
