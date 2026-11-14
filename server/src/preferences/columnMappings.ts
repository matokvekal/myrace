/**
 * Phase 2 — shared column-mapping dictionary (column_mappings, migration 015).
 * Mounted on the /api/v1/me router (signed-in users only).
 *
 *   GET  /api/v1/me/column-mappings?h=<header>&h=…   → { mappings: SharedMappingView[] }
 *        For each header: MY confirmed field, and other organizers' agreed suggestion (counts
 *        only — never who), or `conflict` when they disagree.
 *   POST /api/v1/me/column-mappings  { mappings: [{ header, field }] }  → { saved }
 *        Records what I confirmed. Headers are normalized here; identity-document headers
 *        and unknown fields are refused. My latest confirmation replaces my earlier one.
 */
import { Router } from "express";
import { z } from "zod";
import { authed } from "../auth/auth.js";
import { db } from "../db/pool.js";
import { ApiError, route } from "../lib/core.js";
import {
  isIdentityHeader,
  isMappableField,
  MAX_HEADER_LENGTH,
  normalizeHeader,
  resolveHeaderVotes,
  type HeaderVotes,
  type MappableField,
} from "../../../src/shared/import/columnMapping.js";

export const columnMappingsRouter = Router();

const MAX_HEADERS = 80;
const headerText = z.string().min(1).max(MAX_HEADER_LENGTH * 2);

columnMappingsRouter.get("/column-mappings", route(async (req, res) => {
  const raw = req.query.h;
  const list = z.array(headerText).max(MAX_HEADERS).parse(Array.isArray(raw) ? raw : raw == null ? [] : [raw]);
  const headers = [...new Set(list.map(normalizeHeader).filter((h) => h && !isIdentityHeader(h)))];
  if (headers.length === 0) {
    res.json({ mappings: [] });
    return;
  }
  const me = authed(req).userId;
  const rows = await db.query<{ header: string; field: string; mine: boolean; users: number }>(
    `SELECT header, field, ("userId" = $2) AS mine, count(*)::int AS users
       FROM column_mappings WHERE header = ANY($1::text[])
      GROUP BY header, field, ("userId" = $2)`,
    [headers, me],
  );
  const votes = new Map<string, HeaderVotes>(headers.map((h) => [h, { mine: null, others: {} }]));
  for (const r of rows) {
    if (!isMappableField(r.field)) continue; // a field this version doesn't know
    const v = votes.get(r.header)!;
    if (r.mine) v.mine = r.field;
    else v.others[r.field as MappableField] = (v.others[r.field as MappableField] ?? 0) + r.users;
  }
  res.json({ mappings: headers.map((h) => resolveHeaderVotes(h, votes.get(h)!)) });
}));

const saveBody = z.object({
  mappings: z.array(z.object({ header: headerText, field: z.string().max(40) })).min(1).max(50),
});

columnMappingsRouter.post("/column-mappings", route(async (req, res) => {
  const { mappings } = saveBody.parse(req.body);
  const me = authed(req).userId;
  const clean = new Map<string, MappableField>();
  for (const m of mappings) {
    const header = normalizeHeader(m.header);
    if (!header) continue;
    if (isIdentityHeader(header)) throw new ApiError(400, "identity_header", "Identity-document columns are never stored");
    if (!isMappableField(m.field)) throw new ApiError(400, "invalid_field", `Unknown field: ${m.field}`);
    clean.set(header, m.field); // last one wins inside one request
  }
  for (const [header, field] of clean) {
    // Same field again: count it. Another field: my new answer replaces my old one.
    await db.query(
      `INSERT INTO column_mappings (header, "userId", field) VALUES ($1, $2, $3)
       ON CONFLICT (header, "userId") DO UPDATE SET
         "timesConfirmed" = CASE WHEN column_mappings.field = EXCLUDED.field THEN column_mappings."timesConfirmed" + 1 ELSE 1 END,
         field = EXCLUDED.field,
         "lastConfirmedAt" = now()`,
      [header, me, field],
    );
  }
  res.json({ saved: clean.size });
}));
