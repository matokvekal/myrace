/**
 * Restored from the PGlite-era tests (startup-schema, migration-009, dist-smoke),
 * now against the dedicated cloud test database only (TEST_DATABASE_URL, name ends
 * in "_test"; its public schema is rebuilt from server/sql before the run):
 *  - the startup schema check passes on a fully migrated database;
 *  - the additive migrations 009 and 010 re-run cleanly and keep existing rows;
 *  - the production bundles run for real: `node dist/server.js` serves health and
 *    the new routes, `node dist/db/migrate-cli.js --check` passes. This also guards
 *    against a stale dist/ (0.1.12 shipped one): the bundle is rebuilt here.
 * The spawned processes never read server/.env (COMMISSAIRE_SKIP_DOTENV=1).
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { checkSchema } from "../../src/db/migrate";
import { closePool, db, pool } from "../../src/db/pool";

const root = fileURLToPath(new URL("../..", import.meta.url));
const sql = (f: string) => readFileSync(new URL(`../../sql/${f}`, import.meta.url), "utf8");
const children: ChildProcess[] = [];
afterAll(async () => {
  children.forEach((c) => c.kill());
  await closePool();
});

describe("startup schema check", () => {
  it("passes on the fully migrated test database: nothing missing, no foreign keys", async () => {
    expect(await checkSchema(pool)).toEqual({ missingMigrations: [], missingTables: [], foreignKeys: 0 });
  });
});

describe("additive migrations re-run cleanly", () => {
  it("009 and 010 keep existing rows and their meaning", async () => {
    const owner = "00000000-0000-4000-8000-0000000000f1";
    const race = "00000000-0000-4000-8000-0000000000f2";
    await db.query(`INSERT INTO users (id, email, name) VALUES ($1, 'mig-owner@x.test', 'Owner') ON CONFLICT DO NOTHING`, [owner]);
    await db.query(`INSERT INTO races (uuid, "ownerUserId", name, "minLapSeconds") VALUES ($1, $2, 'Old race', 60) ON CONFLICT DO NOTHING`, [race, owner]);
    const before = await db.one(`SELECT name, "minLapSeconds", "deletedAt", "publishedAt" FROM races WHERE uuid = $1`, [race]);
    for (const f of ["009-waves-bibs-laps-preferences.sql", "010-race-deletion-publishing.sql"]) {
      await pool.query(`BEGIN;\n${sql(f)}\nCOMMIT;`);
    }
    expect(await db.one(`SELECT name, "minLapSeconds", "deletedAt", "publishedAt" FROM races WHERE uuid = $1`, [race])).toEqual(before);
    expect(before).toMatchObject({ deletedAt: null, publishedAt: null }); // existing races: not deleted, not public
    expect(await checkSchema(pool)).toEqual({ missingMigrations: [], missingTables: [], foreignKeys: 0 });
  });
});

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

describe("production bundles (dist-smoke)", () => {
  const env = { ...process.env, COMMISSAIRE_SKIP_DOTENV: "1", NODE_ENV: "test", DATABASE_URL: process.env.TEST_DATABASE_URL! };

  it("rebuild, then migrate-cli --check passes", () => {
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "ignore", shell: true });
    const out = execFileSync(process.execPath, ["dist/db/migrate-cli.js", "--check"], { cwd: root, env, encoding: "utf8" });
    expect(out).toContain("Schema check passed.");
    const bundle = readFileSync(new URL("../../dist/server.js", import.meta.url), "utf8");
    expect(bundle).not.toContain("migrate-cli"); // the command line stays out of the server bundle
  });

  it("node dist/server.js serves health and the access-rule routes", async () => {
    const port = await freePort();
    const p = spawn(process.execPath, ["dist/server.js"], { cwd: root, env: { ...env, PORT: String(port), HOST: "127.0.0.1" } });
    children.push(p);
    const base = `http://127.0.0.1:${port}/api/v1`;
    let health: Response | null = null;
    for (let i = 0; i < 60 && !health; i++) {
      health = await fetch(`${base}/health`).catch(() => null);
      if (!health) await new Promise((r) => setTimeout(r, 500));
    }
    expect(health?.status).toBe(200);
    expect((await fetch(`${base}/public/races/not-a-token`)).status).toBe(404);
    expect((await fetch(`${base}/races`)).status).toBe(401);
    expect((await fetch(`${base}/races/00000000-0000-4000-8000-000000000000/share-link`)).status).toBe(401);
  });
});
