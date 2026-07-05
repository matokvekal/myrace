# Cloud System — START HERE

**Updated:** 2026-07-04 · **Status:** code complete & building. Waiting on: Supabase project (human step) → then two-device testing.

This folder is everything about the cloud layer (Supabase auth + DB + sync + per-race roles). Read in number order; stop when you have what you need.

## Reading order

| # | File | What it gives you | Read when |
|---|---|---|---|
| 1 | [1-overview.md](1-overview.md) | What was built, the golden local-first rule, full file map, what's NOT done | **Always read first** |
| 2 | [2-setup-supabase.md](2-setup-supabase.md) | Build the backend from zero in ~15 min (Supabase + Google OAuth + SQL + .env) | Before first use — **this is the next action** |
| 3 | [3-testing.md](3-testing.md) | 24-test two-device plan (not yet executed) | Right after setup |
| 4 | [4-architecture.md](4-architecture.md) | How it works: layers, events, sync, realtime, offline, conflicts | Before changing sync code |
| 5 | [5-security.md](5-security.md) | Roles, permission matrix, RLS policies, threat notes | Before changing permissions |
| 6 | [6-database.md](6-database.md) | Every table, ER diagram, schema change log | Before changing the schema |
| 7 | [7-production-checklist.md](7-production-checklist.md) | Go-live gates | Before real races / launch |
| 8 | [8-roadmap.md](8-roadmap.md) | V1 → V1.1 → V2 plan + invariants that must never break | When planning next work |
| 9 | [9-stage2-summary.md](9-stage2-summary.md) | Final Stage 2 report: done / remaining / limitations / recommendations | For a status snapshot |

The SQL itself lives at [`supabase/migrations/0001_cloud_schema.sql`](../../supabase/migrations/0001_cloud_schema.sql).

## Current next steps (in order)

1. **Human:** follow `2-setup-supabase.md` (create project, Google OAuth, run SQL, `.env.local`).
2. **Together:** execute `3-testing.md` on two devices, fill in the Result columns.
3. **Then:** commit the work; start V1.1 items from `8-roadmap.md`.

## Rules that must never break

1. The app works fully offline with no account — cloud is an overlay, never a requirement.
2. IndexedDB is the UI's source of truth; Supabase only syncs.
3. Client `can()` checks are UX; Postgres RLS is the real enforcement; change both together.
