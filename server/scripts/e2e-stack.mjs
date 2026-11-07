#!/usr/bin/env node
/**
 * Local full stack for the multi-user browser specs — never production.
 *
 *   cd server && npm run e2e:stack              # DB + API :4100 + app :3100, Ctrl+C stops all
 *   npm run e2e:stack -- --no-app               # DB + API only
 *   npm run e2e:stack -- --no-build             # reuse server/dist
 *   npm run e2e:stack -- --stop                 # stop the API/app of a run killed without Ctrl+C
 *
 * 1. Starts the isolated PostgreSQL of docker-compose.test.yml (127.0.0.1:55432).
 * 2. Creates a SEPARATE database `commissaire_e2e_test` in it if missing (the unit/DB
 *    tests own `commissaire_test`; this script never touches it) and rebuilds its schema
 *    from server/sql (001…, never 000) — every run starts empty.
 * 3. Builds and starts the API on 127.0.0.1:4100 in test mode (NODE_ENV=test,
 *    COMMISSAIRE_SKIP_DOTENV=1: server/.env is never read), mail logged, not sent.
 * 4. Serves the web app with Vite on http://localhost:3100 (VITE_SERVER_URL set here,
 *    not in Git Bash, which rewrites "/" values).
 *
 * Logs: <os tmp>/commissaire-e2e/api.log and app.log. The API log holds every "sent"
 * email (MAIL_TRANSPORT=log), e.g. sign-in / reset codes.
 * Then: MULTIUSER_E2E=1 E2E_API_URL=http://localhost:4100 MULTIUSER_API=http://localhost:4100
 *       E2E_BASE_URL=http://localhost:3100 npx playwright test tests/event-judges.spec.ts
 */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const rootDir = join(serverDir, "..");
const composeFile = join(rootDir, "docker-compose.test.yml");
const args = new Set(process.argv.slice(2));
const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
const HOST = "127.0.0.1:55432";
const ADMIN_URL = `postgresql://commissaire_test:commissaire_test@${HOST}/commissaire_test`;
const E2E_DB = "commissaire_e2e_test";
const E2E_URL = `postgresql://commissaire_test:commissaire_test@${HOST}/${E2E_DB}`;
const logDir = join(tmpdir(), "commissaire-e2e");
mkdirSync(logDir, { recursive: true });
const pidFile = join(logDir, "pids.json");

// Processes of an earlier run that was killed without Ctrl+C (e.g. its terminal closed):
// stop them first, so two stacks never run at once. `--stop` does only this.
function killPrevious() {
  let pids = [];
  try { pids = JSON.parse(readFileSync(pidFile, "utf8")); } catch { return; }
  for (const pid of pids) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else try { process.kill(pid, "SIGTERM"); } catch { /* gone */ }
  }
  try { unlinkSync(pidFile); } catch { /* gone */ }
}
killPrevious();
if (args.has("--stop")) process.exit(0);

// Guard: only a *_test database on loopback, ever.
const u = new URL(E2E_URL);
if (!/_test$/.test(u.pathname.slice(1)) || !["127.0.0.1", "localhost", "::1"].includes(u.hostname)) {
  console.error("Refusing: the e2e database must end in _test and be on this machine.");
  process.exit(2);
}

const shell = process.platform === "win32";
const run = (cmd, a, cwd) => spawnSync(cmd, a, { stdio: "inherit", cwd, shell });

if (run("docker", ["compose", "-f", composeFile, "up", "-d", "--wait"], serverDir).status !== 0) {
  console.error("Could not start the test database (is Docker running?).");
  process.exit(1);
}

// 2. Separate e2e database + fresh schema.
const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [E2E_DB])).rowCount) {
  await admin.query(`CREATE DATABASE ${E2E_DB}`);
  console.log(`created database ${E2E_DB}`);
}
await admin.end();
const db = new pg.Client({ connectionString: E2E_URL });
await db.connect();
const name = (await db.query("SELECT current_database() AS d")).rows[0].d;
if (name !== E2E_DB) throw new Error(`refusing to reset database "${name}"`);
await db.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
const sqlDir = join(serverDir, "sql");
for (const f of readdirSync(sqlDir).filter((f) => /^\d{3}-.+\.sql$/.test(f) && !f.startsWith("000-")).sort()) {
  await db.query(readFileSync(join(sqlDir, f), "utf8"));
}
await db.end();
console.log(`schema of ${E2E_DB} rebuilt`);

// 3. API.
if (!args.has("--no-build") && run("npm", ["run", "build"], serverDir).status !== 0) process.exit(1);
const children = [];
const start = (label, cmd, a, cwd, env) => {
  const log = createWriteStream(join(logDir, `${label}.log`));
  const p = spawn(cmd, a, { cwd, env: { ...process.env, ...env }, shell, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.pipe(log);
  p.stderr.pipe(log);
  p.on("exit", (code) => {
    console.log(`${label} exited (${code})`);
    if (!stopping) stop(1);
  });
  children.push(p);
  writeFileSync(pidFile, JSON.stringify(children.map((c) => c.pid)));
  return p;
};
const apiEnv = {
  NODE_ENV: "test",
  COMMISSAIRE_SKIP_DOTENV: "1",
  DATABASE_URL: E2E_URL,
  JWT_ACCESS_SECRET: "e2e-dummy-secret-e2e-dummy-secret-0001",
  MAIL_TRANSPORT: "log",
  SMS_ENABLED: "false",
  APP_URL: `http://localhost:${APP_PORT}`,
  CORS_ORIGINS: `http://localhost:${APP_PORT},http://127.0.0.1:${APP_PORT}`,
  AUTH_RATE_LIMIT: "100000",
  PORT: String(API_PORT),
  HOST: "127.0.0.1",
  LOG_LEVEL: "info",
};
// Never inherit production database / TLS settings.
for (const k of ["COMMISSAIRE_DATABASE_URL", "DATABASE_CA_CERT_FILE", "DATABASE_CA_CERT", "DATABASE_TLS_SERVERNAME", "TEST_DATABASE_ALLOW_REMOTE"]) delete process.env[k];
start("api", "node", ["dist/server.js"], serverDir, apiEnv);

// 4. App.
if (!args.has("--no-app")) {
  start("app", "npx", ["vite", "--port", String(APP_PORT), "--strictPort"], rootDir, { VITE_SERVER_URL: `http://localhost:${API_PORT}` });
}

async function waitFor(url, label) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return console.log(`${label} ready: ${url}`);
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`${label} did not come up — see ${logDir}`);
  stop(1);
}
let stopping = false;
function stop(code = 0) {
  stopping = true;
  for (const p of children) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
    else p.kill("SIGTERM");
  }
  try { unlinkSync(pidFile); } catch { /* gone */ }
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
// Windows: killing the npm/shell that started us sends no signal, which used to leave the
// API and Vite running (and holding memory). Stop when the parent process is gone.
const parentPid = process.ppid;
setInterval(() => {
  try {
    process.kill(parentPid, 0);
  } catch {
    stop(0);
  }
}, 2000).unref();

await waitFor(`http://127.0.0.1:${API_PORT}/api/v1/health`, "API");
if (!args.has("--no-app")) await waitFor(`http://localhost:${APP_PORT}/`, "App");
console.log(`logs: ${logDir}`);
console.log(`run: MULTIUSER_E2E=1 E2E_API_URL=http://localhost:${API_PORT} MULTIUSER_API=http://localhost:${API_PORT} E2E_BASE_URL=http://localhost:${APP_PORT} npx playwright test <spec>`);
console.log("Ctrl+C stops the API and the app (the database container keeps running; npm run test:db:down removes it).");
