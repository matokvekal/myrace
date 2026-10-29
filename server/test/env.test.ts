/**
 * Production on the same server as PostgreSQL: a loopback database connects
 * without TLS, a remote one is always verified, and loopback alone never lets
 * the API migrate or the tests touch a real database.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { envFilePath, parseEnv } from "../src/config/env";

describe("server/.env location", () => {
  it("is the same file from the sources (tsx) and from the dist/server.js bundle (npm start)", () => {
    const expected = fileURLToPath(new URL("../.env", import.meta.url));
    expect(envFilePath(new URL("../src/config/env.ts", import.meta.url).href)).toBe(expected);
    expect(envFilePath(new URL("../dist/server.js", import.meta.url).href)).toBe(expected);
  });
});
import { databaseConnection } from "../src/db/tls";

const base = {
  COMMISSAIRE_SKIP_DOTENV: "1",
  JWT_ACCESS_SECRET: "x".repeat(40),
  DATABASE_URL: "postgresql://commissaire_app:pw@127.0.0.1:5432/commissaire",
};

describe("production configuration", () => {
  it("a loopback database in production: accepted, no TLS needed; a remote one stays verified", () => {
    const env = parseEnv({ ...base, NODE_ENV: "production", HOST: "127.0.0.1" });
    expect(env.HOST).toBe("127.0.0.1");
    expect(databaseConnection(env.DATABASE_URL).ssl).toBe(false);
    expect(databaseConnection("postgresql://u:p@db.commissaire.us:5432/commissaire").ssl).toEqual({ rejectUnauthorized: true });
  });

  it("DEV_PGLITE is refused in production, even with a loopback database (no automatic migrations)", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production", DEV_PGLITE: "true" })).toThrow(/DEV_PGLITE is for the local PGlite dev database only/);
    expect(parseEnv({ ...base, NODE_ENV: "development", DEV_PGLITE: "true" }).DEV_PGLITE).toBe(true);
  });

  it("HOST unset listens on every interface (local development)", () => {
    expect(parseEnv({ ...base }).HOST).toBeUndefined();
    expect(parseEnv({ ...base, HOST: "" }).HOST).toBeUndefined(); // "HOST=" copied from .env.example
  });
});

describe("tests never reach a real database", () => {
  it("NODE_ENV=test requires skipping server/.env, and a local database", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "test", COMMISSAIRE_SKIP_DOTENV: undefined })).toThrow(/must not read server\/\.env/);
    expect(() => parseEnv({ ...base, NODE_ENV: "test", DATABASE_URL: "postgresql://u:p@db.commissaire.us/x" })).toThrow(/only against a local database/);
    expect(parseEnv({ ...base, NODE_ENV: "test" }).NODE_ENV).toBe("test");
  });
});
