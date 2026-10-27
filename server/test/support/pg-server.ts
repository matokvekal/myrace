/**
 * Test helper process: an in-memory PostgreSQL (PGlite) on a free loopback port.
 *   full           001–008 applied
 *   recorded-only  001 tables only, every migration file recorded
 * Prints "PORT <n>" when ready. Runs apart from the test process so a client
 * killed hard (Windows) cannot break the test run with a connection reset.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { migrate, migrationFiles } from "../../src/db/migrate";

process.on("uncaughtException", (err) => {
  if ((err as NodeJS.ErrnoException).code === "ECONNRESET") return;
  console.error(err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  if ((err as NodeJS.ErrnoException)?.code === "ECONNRESET") return;
  console.error(err);
  process.exit(1);
});

const kind = process.argv[2];
const db = await PGlite.create();
if (kind === "full") await migrate((s) => db.exec(s), async () => new Set());
else if (kind === "recorded-only") {
  await db.exec(`BEGIN;\n${readFileSync(new URL("../../sql/001-users-auth.sql", import.meta.url), "utf8")}\nCOMMIT;`);
  for (const f of migrationFiles()) await db.query("INSERT INTO schema_migrations VALUES ($1) ON CONFLICT DO NOTHING", [f.slice(0, -4)]);
} else throw new Error(`unknown kind ${kind}`);

const port = await new Promise<number>((resolve) => {
  const s = createServer().listen(0, "127.0.0.1", () => {
    const p = (s.address() as AddressInfo).port;
    s.close(() => resolve(p));
  });
});
await new PGLiteSocketServer({ db, port, host: "127.0.0.1" }).start();
console.log(`PORT ${port}`);
process.stdin.resume();
process.stdin.on("end", () => process.exit(0)); // the test closes stdin to stop it
