/**
 * Cloud PostgreSQL only: local development must use the cloud database (no local
 * fallback); production on the same server as PostgreSQL connects over loopback
 * without TLS, a remote one is always verified, and tests never touch a real database.
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
const CLOUD = "postgresql://commissaire_app:pw@db.commissaire.us:5432/commissaire?sslmode=require";

describe("production configuration", () => {
  it("a loopback database in production: accepted, no TLS needed; a remote one stays verified", () => {
    const env = parseEnv({ ...base, NODE_ENV: "production", HOST: "127.0.0.1" });
    expect(env.HOST).toBe("127.0.0.1");
    expect(databaseConnection(env.DATABASE_URL).ssl).toBe(false);
    expect(databaseConnection("postgresql://u:p@db.commissaire.us:5432/commissaire").ssl).toEqual({ rejectUnauthorized: true });
  });

  it("HOST unset listens on every interface (local development)", () => {
    expect(parseEnv({ ...base, DATABASE_URL: CLOUD }).HOST).toBeUndefined();
    expect(parseEnv({ ...base, DATABASE_URL: CLOUD, HOST: "" }).HOST).toBeUndefined(); // "HOST=" copied from .env.example
  });
});

describe("cloud PostgreSQL only", () => {
  it("local development refuses a local database — no fallback; the cloud one is accepted", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "development" })).toThrow(/cloud PostgreSQL database only/);
    expect(() => parseEnv({ ...base, NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost:5433/postgres" })).toThrow(/cloud PostgreSQL database only/);
    expect(parseEnv({ ...base, NODE_ENV: "development", DATABASE_URL: CLOUD }).DATABASE_URL).toBe(CLOUD);
  });

  it("a missing DATABASE_URL fails clearly", () => {
    expect(() => parseEnv({ COMMISSAIRE_SKIP_DOTENV: "1", JWT_ACCESS_SECRET: "x".repeat(40) })).toThrow(/DATABASE_URL/);
  });
});

describe("tests never reach production data", () => {
  const TEST_DB = "postgresql://commissaire_app:pw@db.commissaire.us:5432/commissaire_test?sslmode=require";
  const LOCAL_TEST_DB = "postgresql://commissaire_test:commissaire_test@127.0.0.1:55432/commissaire_test";
  it("NODE_ENV=test requires skipping server/.env", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "test", DATABASE_URL: TEST_DB, COMMISSAIRE_SKIP_DOTENV: undefined })).toThrow(/must not read server\/\.env/);
  });
  it("only a database named *_test is accepted — the production one (and any other) is refused", () => {
    for (const url of [CLOUD, base.DATABASE_URL, "postgresql://u:p@db.commissaire.us/elnino", "postgresql://u:p@db.commissaire.us/commissaire_testing", "postgresql://u:p@db.commissaire.us/"]) {
      expect(() => parseEnv({ ...base, NODE_ENV: "test", DATABASE_URL: url }), url).toThrow(/dedicated test database/);
    }
    expect(parseEnv({ ...base, NODE_ENV: "test", DATABASE_URL: LOCAL_TEST_DB }).DATABASE_URL).toBe(LOCAL_TEST_DB);
  });
  it("a *_test database on another machine needs TEST_DATABASE_ALLOW_REMOTE=1 (a copied URL is never used by accident)", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "test", DATABASE_URL: TEST_DB })).toThrow(/dedicated test database/);
    expect(parseEnv({ ...base, NODE_ENV: "test", DATABASE_URL: TEST_DB, TEST_DATABASE_ALLOW_REMOTE: "1" }).DATABASE_URL).toBe(TEST_DB);
  });
});
