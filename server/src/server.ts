import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { autoMigrateAllowed, closePool, pool } from "./db/pool.js";
import { checkSchema, migratePool } from "./db/migrate.js";
import { logger } from "./lib/core.js";
import { attachRealtime, closeRealtime } from "./realtime/socket.js";

const stop = async (msg: string, details: object) => {
  logger.fatal(details, msg);
  await closePool().catch(() => {});
  process.exit(1);
};

// Only the local PGlite dev database is migrated here. Any other database is
// migrated by hand; the API refuses to start until every file is applied and
// every required table exists.
try {
  if (autoMigrateAllowed()) {
    const ran = await migratePool(pool);
    if (ran.length) logger.info({ ran }, "migrations applied (local PGlite dev database)");
  }
  const schema = await checkSchema(pool);
  if (schema.missingMigrations.length) {
    await stop(`database is missing migrations — run them by hand, in order: ${schema.missingMigrations.join(", ")}`, { missing: schema.missingMigrations });
  }
  if (schema.missingTables.length) {
    await stop(`database is missing tables although their migrations are recorded: ${schema.missingTables.join(", ")}`, { missingTables: schema.missingTables });
  }
  if (schema.foreignKeys > 0) logger.warn({ foreignKeys: schema.foreignKeys }, "database has foreign keys; policy is none (run 006)");
  logger.info("database schema check passed");
} catch (err) {
  // pg errors carry no connection string; log only the message and code.
  const e = err as { message?: string; code?: string };
  await stop(`cannot use the database: ${e.message ?? "unknown error"}`, { code: e.code });
}

const http = createServer(createApp());
attachRealtime(http);
http.listen(env.PORT, () => logger.info({ port: env.PORT }, "Commissaire server listening"));

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "shutting down");
  http.close();
  await closeRealtime();
  await closePool();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
