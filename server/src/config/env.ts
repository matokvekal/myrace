import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

/** Loads server/.env into process.env (values already set win). No dependency needed. */
function loadDotEnv(path = new URL("../../.env", import.meta.url)) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
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
  COMMISSAIRE_DATABASE_URL: z.string().min(1, "COMMISSAIRE_DATABASE_URL is required"),
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
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration — ${problems}`);
  }
  const env = result.data;
  if (env.NODE_ENV === "production" && env.MAIL_TRANSPORT === "smtp" && !env.SMTP_URL) {
    throw new Error("Invalid server configuration — SMTP_URL is required when MAIL_TRANSPORT=smtp");
  }
  return env;
}

export const env: Env = parse();
