import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

/** The database URL in server/.env beats an inherited one: a shell's DATABASE_URL may be El Niño's. */
const DB_KEYS = ["DATABASE_URL", "COMMISSAIRE_DATABASE_URL"];

/**
 * Loads server/.env into process.env (values already set win, except the
 * database URL). No dependency needed. Tests set COMMISSAIRE_SKIP_DOTENV=1.
 */
function loadDotEnv(path = new URL("../../.env", import.meta.url)) {
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

function parse(): Env {
  const source = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || process.env.COMMISSAIRE_DATABASE_URL };
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration — ${problems}`);
  }
  const env = result.data;
  if (env.NODE_ENV === "production" && env.MAIL_TRANSPORT === "smtp" && !env.SMTP_URL) {
    throw new Error("Invalid server configuration — SMTP_URL is required when MAIL_TRANSPORT=smtp");
  }
  // Tests create users and races: never against a real (non-local) database.
  if (env.NODE_ENV === "test" && !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(env.DATABASE_URL).hostname)) {
    throw new Error("Invalid server configuration — tests run only against a local database");
  }
  return env;
}

export const env: Env = parse();
