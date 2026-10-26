/**
 * An organizer's reusable commissaire directory: contacts and groups (e.g.
 * "Federation A"). Private to its owner; being in a directory grants no race
 * access — invitations do. Also: look up an existing user by exact email.
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { authed, requireAuth } from "../auth/auth.js";
import { db } from "../db/pool.js";
import { ApiError, normalizeEmail, route } from "../lib/core.js";

export const directoryRouter = Router();
directoryRouter.use(requireAuth);

const contactBody = z.object({ name: z.string().trim().max(150).default(""), email: z.string().email().optional(), userId: z.string().uuid().optional() });

const linkUser = async (email: string | undefined) =>
  email ? (await db.one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [normalizeEmail(email)]))?.id ?? null : null;

directoryRouter.get("/contacts", route(async (req, res) => {
  const rows = await db.query(
    `SELECT c.id, c.name, c.email, c."userId", u.name AS "userName",
            COALESCE(array_agg(gm."groupId") FILTER (WHERE gm."groupId" IS NOT NULL), '{}') AS "groupIds"
     FROM contacts c LEFT JOIN users u ON u.id = c."userId" LEFT JOIN contact_group_members gm ON gm."contactId" = c.id
     WHERE c."ownerUserId" = $1 GROUP BY c.id, u.name ORDER BY c.name, c.email`,
    [authed(req).userId],
  );
  res.json({ contacts: rows });
}));

directoryRouter.post("/contacts", route(async (req, res) => {
  const b = contactBody.parse(req.body);
  if (!b.email && !b.userId) throw new ApiError(400, "invalid", "A contact needs an email or an account");
  const email = b.email ? normalizeEmail(b.email) : null;
  const userId = b.userId ?? (await linkUser(email ?? undefined));
  const row = await db.one(
    `INSERT INTO contacts ("ownerUserId", name, email, "userId") VALUES ($1, $2, $3, $4)
     ON CONFLICT ("ownerUserId", email) WHERE email IS NOT NULL DO UPDATE SET name = EXCLUDED.name, "updatedAt" = now()
     RETURNING id, name, email, "userId"`,
    [authed(req).userId, b.name, email, userId],
  );
  res.status(201).json({ contact: row });
}));

directoryRouter.patch("/contacts/:id", route(async (req, res) => {
  const b = contactBody.partial().parse(req.body);
  const email = b.email ? normalizeEmail(b.email) : undefined;
  const row = await db.one(
    `UPDATE contacts SET name = COALESCE($3, name), email = COALESCE($4, email),
       "userId" = COALESCE($5, "userId"), "updatedAt" = now()
     WHERE id = $1 AND "ownerUserId" = $2 RETURNING id, name, email, "userId"`,
    [String(req.params.id), authed(req).userId, b.name ?? null, email ?? null, b.userId ?? (await linkUser(email))],
  );
  if (!row) throw new ApiError(404, "not_found", "No such contact");
  res.json({ contact: row });
}));

directoryRouter.delete("/contacts/:id", route(async (req, res) => {
  await db.query(`DELETE FROM contacts WHERE id = $1 AND "ownerUserId" = $2`, [String(req.params.id), authed(req).userId]);
  res.status(204).end();
}));

directoryRouter.get("/groups", route(async (req, res) => {
  const rows = await db.query(
    `SELECT g.id, g.name, COALESCE(array_agg(gm."contactId") FILTER (WHERE gm."contactId" IS NOT NULL), '{}') AS "contactIds"
     FROM contact_groups g LEFT JOIN contact_group_members gm ON gm."groupId" = g.id
     WHERE g."ownerUserId" = $1 GROUP BY g.id ORDER BY g.name`,
    [authed(req).userId],
  );
  res.json({ groups: rows });
}));

directoryRouter.post("/groups", route(async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body);
  const row = await db.one(`INSERT INTO contact_groups ("ownerUserId", name) VALUES ($1, $2) RETURNING id, name`, [authed(req).userId, name]).catch((e) => {
    if ((e as { code?: string }).code === "23505") throw new ApiError(409, "group_exists", "You already have a group with this name");
    throw e;
  });
  res.status(201).json({ group: row });
}));

directoryRouter.patch("/groups/:id", route(async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(120) }).parse(req.body);
  const row = await db.one(`UPDATE contact_groups SET name = $3, "updatedAt" = now() WHERE id = $1 AND "ownerUserId" = $2 RETURNING id, name`, [String(req.params.id), authed(req).userId, name]);
  if (!row) throw new ApiError(404, "not_found", "No such group");
  res.json({ group: row });
}));

directoryRouter.delete("/groups/:id", route(async (req, res) => {
  await db.query(`DELETE FROM contact_groups WHERE id = $1 AND "ownerUserId" = $2`, [String(req.params.id), authed(req).userId]);
  res.status(204).end();
}));

directoryRouter.put("/groups/:id/contacts", route(async (req, res) => {
  const { contactIds } = z.object({ contactIds: z.array(z.string().uuid()).max(1000) }).parse(req.body);
  const g = await db.one(`SELECT 1 FROM contact_groups WHERE id = $1 AND "ownerUserId" = $2`, [String(req.params.id), authed(req).userId]);
  if (!g) throw new ApiError(404, "not_found", "No such group");
  await db.query(`DELETE FROM contact_group_members WHERE "groupId" = $1`, [String(req.params.id)]);
  await db.query(
    `INSERT INTO contact_group_members ("groupId", "contactId")
     SELECT $1, c.id FROM contacts c WHERE c.id = ANY($2::uuid[]) AND c."ownerUserId" = $3`,
    [String(req.params.id), contactIds, authed(req).userId],
  );
  res.status(204).end();
}));

/** Find an existing user by exact email (no partial search, so accounts can't be listed). */
directoryRouter.get(
  "/users/lookup",
  rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }),
  route(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.query);
    const u = await db.one<{ id: string; name: string }>(`SELECT id, name FROM users WHERE email = $1 AND "isActive"`, [normalizeEmail(email)]);
    if (!u) throw new ApiError(404, "not_found", "No account with this email — send an invitation instead");
    res.json({ user: u });
  }),
);
