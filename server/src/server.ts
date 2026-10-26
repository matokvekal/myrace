import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { closePool, pool } from "./db/pool.js";
import { migratePool } from "./db/migrate.js";
import { logger } from "./lib/core.js";
import { attachRealtime, closeRealtime } from "./realtime/socket.js";

const ran = await migratePool(pool);
if (ran.length) logger.info({ ran }, "migrations applied");

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
