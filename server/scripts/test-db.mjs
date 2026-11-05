#!/usr/bin/env node
/**
 * Runs the server tests (unit + database) against the ISOLATED test database.
 *
 *   npm run test:db                 # start docker-compose.test.yml, run all server tests
 *   npm run test:db -- test/db/races.test.ts   # extra args go to vitest
 *   TEST_DB_NO_DOCKER=1 npm run test:db        # CI: the database is already running
 *
 * Never reads server/.env. TEST_DATABASE_URL defaults to the local container; any
 * other value must still pass isSafeTestDatabase (name ends in _test, on this machine
 * unless TEST_DATABASE_ALLOW_REMOTE=1), or nothing runs.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = join(serverDir, "..", "docker-compose.test.yml");
const LOCAL_URL = "postgresql://commissaire_test:commissaire_test@127.0.0.1:55432/commissaire_test";

const url = process.env.TEST_DATABASE_URL || LOCAL_URL;
const LOOPBACK = ["localhost", "127.0.0.1", "::1", "[::1]"];
let safe = false;
try {
  const u = new URL(url);
  safe = /_test$/.test(decodeURIComponent(u.pathname.slice(1))) && (LOOPBACK.includes(u.hostname) || process.env.TEST_DATABASE_ALLOW_REMOTE === "1");
} catch {
  safe = false;
}
if (!safe) {
  console.error("Refusing to run: TEST_DATABASE_URL must be a *_test database on this machine (or set TEST_DATABASE_ALLOW_REMOTE=1).");
  process.exit(2);
}

const run = (cmd, args, env = process.env) => spawnSync(cmd, args, { stdio: "inherit", cwd: serverDir, env, shell: process.platform === "win32" });

if (process.env.TEST_DB_NO_DOCKER !== "1" && url === LOCAL_URL) {
  const up = run("docker", ["compose", "-f", composeFile, "up", "-d", "--wait"]);
  if (up.status !== 0) {
    console.error("Could not start the test database (is Docker running?).");
    process.exit(up.status ?? 1);
  }
}

const env = { ...process.env, TEST_DATABASE_URL: url };
// Never inherit production TLS settings into the local run.
if (url === LOCAL_URL) for (const k of ["DATABASE_CA_CERT_FILE", "DATABASE_CA_CERT", "DATABASE_TLS_SERVERNAME"]) delete env[k];
const r = run("npx", ["vitest", "run", ...process.argv.slice(2)], env);
process.exit(r.status ?? 1);
