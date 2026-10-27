import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** The database URL in server/.env beats an inherited one: a shell's DATABASE_URL may be El Niño's. */
const DB_KEYS = ["DATABASE_URL", "COMMISSAIRE_DATABASE_URL"];

/**
 * server/.env: next to the nearest package.json above this module, so the same
 * file is found from src/config/env.ts (tsx) and from the dist/server.js bundle.
 */
export function envFilePath(from: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(from));
  while (!existsSync(join(dir, "package.json"))) {
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return join(dir, ".env");
}

/**
 * Loads server/.env into process.env (values already set win, except the
 * database URL). No dependency needed. Tests set COMMISSAIRE_SKIP_DOTENV=1.
 */
function loadDotEnv(path = envFilePath()) {
  if (process.env.COMMISSAIRE_SKIP_DOTENV === "1" || !existsSync(path)) return;
  const fromFile: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    fromFile[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const fileHasDb = DB_KEYS.some((k) => fromFile[k]);
  for (const [k, v] of Object.entries(fromFile)) if (process.env[k] === undefined) process.env[k] = v;
  if (fileHasDb) for (const k of DB_KEYS) {
    if (fromFile[k]) process.env[k] = fromFile[k];
    else delete process.env[k];
  }
}
loadDotEnv();

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");
const list = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  // Interface to listen on. Production behind Nginx: 127.0.0.1, so only the proxy reaches the API.
  // Unset: every interface (local development).
  HOST: z.string().optional().transform((v) => v || undefined),
  // DATABASE_URL is primary; COMMISSAIRE_DATABASE_URL is the older name, still read (see parse()).
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Only the local PGlite dev database (`npm run db:dev`) may be migrated by the API, and only
  // when this is set AND the host is loopback. Any other database is checked, never migrated.
  DEV_PGLITE: bool,
  // TLS to a non-local database is always verified (src/db/tls.ts). For a private or
  // self-signed server certificate, give the CA (or that certificate) to trust, as PEM
  // text ("\n" escapes allowed) or a file path, and the certificate's name when the URL
  // host differs from it (e.g. an IP address).
  DATABASE_CA_CERT: z.string().optional(),
  DATABASE_CA_CERT_FILE: z.string().optional(),
  DATABASE_TLS_SERVERNAME: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ORIGINS: list,
  APP_URL: z.string().url().default("http://localhost:3000"),
  GOOGLE_CLIENT_IDS: list,
  MAIL_TRANSPORT: z.enum(["log", "smtp"]).default("log"),
  SMTP_URL: z.string().optional().default(""),
  MAIL_FROM: z.string().default("Commissaire <no-reply@commissaire.us>"),
  SMS_ENABLED: bool,
  SMS_PROVIDER: z.enum(["log"]).default("log"),
  RESULTS_SIGNING_KEY: z.string().optional().default(""),
  RESULTS_SIGNING_KEY_ID: z.string().default("dev"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(vars: NodeJS.ProcessEnv = process.env): Env {
  const source = { ...vars, DATABASE_URL: vars.DATABASE_URL || vars.COMMISSAIRE_DATABASE_URL };
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration — ${problems}`);
  }
  const env = result.data;
  if (env.NODE_ENV === "production" && env.MAIL_TRANSPORT === "smtp" && !env.SMTP_URL) {
    throw new Error("Invalid server configuration — SMTP_URL is required when MAIL_TRANSPORT=smtp");
  }
  // The production database may be on loopback (same server), so loopback alone never allows migrating it.
  if (env.NODE_ENV === "production" && env.DEV_PGLITE) {
    throw new Error("Invalid server configuration — DEV_PGLITE is for the local PGlite dev database only; remove it in production");
  }
  // Tests create users and races: never against a real database. They use the in-memory
  // database of test/global-setup.ts, which also skips server/.env (it may hold production's URL).
  if (env.NODE_ENV === "test") {
    if (vars.COMMISSAIRE_SKIP_DOTENV !== "1") {
      throw new Error("Invalid server configuration — tests must not read server/.env (run them with vitest)");
    }
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(env.DATABASE_URL).hostname)) {
      throw new Error("Invalid server configuration — tests run only against a local database");
    }
  }
  return env;
}

export const env: Env = parseEnv();
