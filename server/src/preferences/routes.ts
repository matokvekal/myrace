/**
 * Per-organizer reusable preferences (user_preferences, migration 009) — e.g.
 * learned Finish Group assignments. Separate from race data: resetting a race
 * never touches them. Each user reads and writes only their own.
 *
 *   GET /api/v1/me/preferences/:key   → { key, value }   (value null if never set)
 *   PUT /api/v1/me/preferences/:key   { value }  → { key, value }
 */
import { Router } from "express";
import { z } from "zod";
import { authed, requireAuth } from "../auth/auth.js";
import { db } from "../db/pool.js";
import { route } from "../lib/core.js";

export const preferencesRouter = Router();
preferencesRouter.use(requireAuth);

const keyParam = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);
const MAX_BYTES = 64 * 1024;

preferencesRouter.get("/preferences/:key", route(async (req, res) => {
  const key = keyParam.parse(req.params.key);
  const row = await db.one<{ value: unknown }>(`SELECT value FROM user_preferences WHERE "userId" = $1 AND key = $2`, [authed(req).userId, key]);
  res.json({ key, value: row?.value ?? null });
}));

preferencesRouter.put("/preferences/:key", route(async (req, res) => {
  const key = keyParam.parse(req.params.key);
  const { value } = z.object({ value: z.unknown() }).parse(req.body);
  const json = JSON.stringify(value ?? null);
  if (Buffer.byteLength(json) > MAX_BYTES) {
    res.status(413).json({ error: { code: "too_large", message: "Preference value is too large" } });
    return;
  }
  await db.query(
    `INSERT INTO user_preferences ("userId", key, value, "updatedAt") VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
    [authed(req).userId, key, json],
  );
  res.json({ key, value: value ?? null });
}));
