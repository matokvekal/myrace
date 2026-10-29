/**
 * The production bundles, run for real: `node dist/server.js` and
 * `node dist/db/migrate-cli.js --check`, each against its own in-memory
 * PostgreSQL. Regression tests for two bugs that only the bundles had:
 *   - sql/ was looked up one folder too high from dist/ (ENOENT at startup);
 *   - the migration command line was bundled into dist/server.js and ran at
 *     every start.
 * The processes never read server/.env (COMMISSAIRE_SKIP_DOTENV=1).
 */
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

/**
 * An in-memory database in its own helper process (test/support/pg-server.ts):
 * "full" = 001–008 applied; "recorded-only" = 001 tables, every file recorded.
 */
async function database(kind: "full" | "recorded-only") {
  const p = spawn(process.execPath, ["--import", "tsx", "test/support/pg-server.ts", kind], { cwd: root, env: { ...process.env, COMMISSAIRE_SKIP_DOTENV: "1" } });
  const port = await new Promise<number>((resolve, reject) => {
    let out = "";
    p.stdout.on("data", (d) => {
      out += d;
      const m = /PORT (\d+)/.exec(out);
      if (m) resolve(Number(m[1]));
    });
    p.stderr.on("data", (d) => (out += d));
    p.on("exit", (code) => reject(new Error(`pg-server exited ${code}: ${out}`)));
  });
  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
  const tables = async () => {
    const c = new pg.Client(url);
    await c.connect();
    try {
      return (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'")).rows[0].n;
    } finally {
      await c.end();
    }
  };
  const close = () =>
    new Promise<void>((resolve) => {
      p.once("exit", () => resolve());
      p.stdin.end();
      setTimeout(() => (p.kill(), resolve()), 5_000);
    });
  return { url, tables, close };
}

const prodEnv = (url: string, extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH ?? "",
  SystemRoot: process.env.SystemRoot ?? "",
  COMMISSAIRE_SKIP_DOTENV: "1",
  NODE_ENV: "production",
  DATABASE_URL: url,
  DB_POOL_MAX: "1",
  JWT_ACCESS_SECRET: "dist-smoke-secret-0123456789abcdefghijkl",
  LOG_LEVEL: "info",
  ...extra,
});

/** Runs dist/server.js until it listens (then stops it) or exits. */
function runServer(env: Record<string, string>, timeoutMs = 45_000) {
  return new Promise<{ listening: boolean; code: number | null; log: string; health?: { ok: boolean; release: string } }>((resolve) => {
    const p = spawn(process.execPath, ["dist/server.js"], { cwd: root, env });
    let log = "";
    let done = false;
    const finish = (r: { listening: boolean; code: number | null; health?: { ok: boolean; release: string } }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ...r, log });
    };
    const onData = async (d: Buffer) => {
      log += d;
      if (!done && log.includes("Commissaire server listening")) {
        const health = (await fetch(`http://127.0.0.1:${env.PORT}/api/v1/health`).then((r) => r.json())) as { ok: boolean; release: string };
        p.kill();
        finish({ listening: true, code: null, health });
      }
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("exit", (code) => finish({ listening: false, code }));
    const timer = setTimeout(() => (p.kill(), finish({ listening: false, code: null })), timeoutMs);
  });
}

/** Async on purpose: the test databases run in this process, so a blocking spawn would starve them. */
const cli = (env: Record<string, string>, ...args: string[]) =>
  new Promise<{ code: number | null; out: string }>((resolve) => {
    const p = spawn(process.execPath, ["dist/db/migrate-cli.js", ...args], { cwd: root, env });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => p.kill(), 20_000);
    p.on("exit", (code) => (clearTimeout(timer), resolve({ code, out })));
  });

beforeAll(() => {
  execFileSync(process.execPath, ["build.mjs"], { cwd: root, stdio: "pipe" });
}, 60_000);

describe("dist/server.js (the production bundle)", { timeout: 60_000 }, () => {
  let full: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => (full = await database("full")));
  afterAll(() => full?.close());

  it("does not contain the migration command line", () => {
    const bundle = readFileSync(new URL("../dist/server.js", import.meta.url), "utf8");
    expect(bundle).not.toContain("Not applied (run by hand");
    expect(bundle).not.toContain("Schema check passed");
  });

  it("starts in production on a complete schema, bound to HOST, and reports its release", async () => {
    const port = String(await freePort());
    const r = await runServer(prodEnv(full.url, { HOST: "127.0.0.1", PORT: port, COMMISSAIRE_RELEASE: "abc1234" }));
    expect(r.log).not.toMatch(/ENOENT|Not applied|Applied:/);
    expect(r.log).toContain("database schema check passed");
    expect(r.listening).toBe(true);
    expect(r.health).toMatchObject({ ok: true, release: "abc1234" });
  });

  it("refuses to start, with a clear message, when tables are missing although recorded", async () => {
    const broken = await database("recorded-only");
    try {
      const r = await runServer(prodEnv(broken.url, { HOST: "127.0.0.1", PORT: String(await freePort()) }));
      expect(r.listening).toBe(false);
      expect(r.code).toBe(1);
      expect(r.log).toContain("database is missing tables although their migrations are recorded");
      expect(r.log).not.toContain("postgres:postgres");
    } finally {
      await broken.close();
    }
  });

  it("refuses DEV_PGLITE in production before touching the database", async () => {
    const r = await runServer(prodEnv(full.url, { PORT: String(await freePort()), DEV_PGLITE: "true" }));
    expect(r.listening).toBe(false);
    expect(r.code).not.toBe(0);
    expect(r.log).toContain("DEV_PGLITE is for the local PGlite dev database only");
  });
});

describe("dist/db/migrate-cli.js --check (read-only, run before every activation)", { timeout: 60_000 }, () => {
  it("passes on a complete schema", async () => {
    const full = await database("full");
    try {
      const r = await cli(prodEnv(full.url), "--check");
      expect(r.out).toContain("Schema check passed.");
      expect(r.code).toBe(0);
    } finally {
      await full.close();
    }
  });

  it("fails, naming what is missing, and never creates anything, even with DEV_PGLITE on a loopback database", async () => {
    const broken = await database("recorded-only");
    try {
      const before = await broken.tables();
      for (const env of [prodEnv(broken.url), prodEnv(broken.url, { NODE_ENV: "development", DEV_PGLITE: "true" })]) {
        const r = await cli(env, "--check");
        expect(r.code).toBe(1);
        expect(r.out).toContain("tables missing: categories");
      }
      expect(await broken.tables()).toBe(before);
    } finally {
      await broken.close();
    }
  });

  it("lists unrecorded files without migrating when no DEV_PGLITE (production)", async () => {
    const empty = await database("recorded-only");
    try {
      const r = await cli(prodEnv(empty.url));
      expect(r.code).toBe(0); // every file is recorded
      expect(r.out).toContain("All migrations are applied.");
    } finally {
      await empty.close();
    }
  });
});
