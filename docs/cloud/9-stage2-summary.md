# Stage 2 Summary — Cloud Integration & Production Readiness

**Date:** 2026-07-04 · **Branch:** `server` (uncommitted working tree)

## Completed

- **Task 1 — Review:** Stage 1 implementation reviewed end to end; no duplication introduced; all further work built on the existing `src/app/services/cloud/` layer.
- **Task 2 — Database verified:** PKs/FKs/cascades/CHECKs/uniques/indexes audited (see `docs/cloud/6-database.md` + change log). Fixes applied: `set_updated_at` triggers on races/riders; migration made fully idempotent (policy drop-guards, exception-safe realtime publication).
- **Task 3 — Security verified:** every RLS policy checked against the role matrix (`docs/cloud/5-security.md`). Fix applied: `riders_update` tightened — CHECKIN and FINISH_JUDGE can no longer update rider rows (they act via events only). Race isolation confirmed by policy review: no membership row → no access path.
- **Task 4 — Google auth:** login/logout/session-restore/token-refresh paths reviewed. Fixes applied: `cloudStore.init()` + `attachOnlineListener()` now run at app root (`App.tsx`), so sessions restore on startup, not only when a race screen mounts; invite claiming + role refresh now also fire on `INITIAL_SESSION` (restored session) and are skipped safely while offline.
- **Task 5 — Setup guide:** `docs/cloud/2-setup-supabase.md` — zero-to-backend in ~15 min, incl. Google OAuth console steps, URL configuration, verification and troubleshooting table.
- **Task 6 — Documentation:** `docs/cloud/4-architecture.md` (diagrams: local-first stack, event flow, sync loop), `docs/cloud/5-security.md`, `docs/cloud/6-database.md` (ER diagram, per-table docs, change log).
- **Task 7 — Sync engine reviewed:** upload / download / realtime / offline queue / reconnect / duplicates / conflicts / pending / rejected / retry — each scenario documented in `docs/cloud/4-architecture.md` §3–§6; behavioral gaps recorded (below).
- **Task 8 — Two-device test plan:** `docs/cloud/3-testing.md` — 24 concrete test cases across 6 parts with expected results. **Execution pending** (see Remaining work).
- **Task 9 — Production checklist:** `docs/cloud/7-production-checklist.md`.
- **Task 10 — Roadmap:** `docs/cloud/8-roadmap.md` (V1 / V1.1 / V2 + architectural invariants).
- **Task 11 — Build:** `vite build` ✅ (9.9s). `tsc --noEmit` ✅ no errors this run (a pre-existing `RacingRider.tsx` filename-casing error TS1261 appeared in earlier runs — Windows filesystem-dependent, unrelated to cloud work). No `npm run typecheck` script exists; `npm run build` = `tsc && vite build`.

## Modified files (Stage 1 + Stage 2 combined)

**New:** `src/app/types/cloud.types.ts` · `src/app/services/cloud/{permissions,supabaseClient,raceEvents,cloudSync}.ts` · `src/app/stores/cloudStore.ts` · `src/app/hooks/{useRacePermission,useCloudRaceSync}.ts` · `src/app/components/cloud/{RaceCloudPanel.tsx,CloudRacesSection.tsx,raceCloudPanel.module.css}` · `supabase/migrations/0001_cloud_schema.sql` · `.env.example` · docs: `cloud-sync, setup-supabase, cloud-architecture, security, database, testing, production-checklist, cloud-roadmap, stage2-summary`.

**Modified:** `src/App.tsx` · `src/app/main/page.tsx` · `src/app/race/[id]/page.tsx` · `src/app/race/[id]/heat/[heatId]/page.tsx` · `src/app/race/[id]/raceMode/CheckIn.tsx` · `src/app/stores/indexDb/indexedDbHelper.ts` (v8→v9) · `src/vite-env.d.ts` · `package.json` (+`@supabase/supabase-js`) · `CLAUDE.md` (docs index).

## Remaining work (open items)

1. **Provision Supabase** — human step: create project, enable Google OAuth, run the SQL, fill `.env.local` (`docs/cloud/2-setup-supabase.md`). Nothing cloud-side can be runtime-tested before this.
2. **Execute `docs/cloud/3-testing.md`** — the two-device matrix, incl. local-first regression Part 1. Stage 2's Definition of Done items "Sync works / Offline works / Two-device testing completed" are **not yet checkable**.
3. **V1.1 seams** (tracked in `docs/cloud/8-roadmap.md`): rider CRUD guards + `RIDER_EDITED` events in Riders/EditRiders screens; heat-start broadcast; rejected-event UI; incremental pull.

## Known limitations

- Riders added after upload reach the cloud only via "Update cloud copy" (manual).
- A revoked member keeps cached local-UI permissions until next online role refresh (server rejects their writes immediately).
- DSQ travels as event type `DNF` with real status in the payload.
- Categories sync only inside the race payload snapshot; mid-race category edits don't propagate as events.
- `pullRemoteEvents` fetches full history each time (fine for hundreds of events; optimize in V1.1).
- Rejected duplicate laps are silent (console + IDB status only).

## Recommendations before production

1. Execute the full test plan on two physical phones on venue-grade networks (not just two browser profiles).
2. Add remote error reporting (Sentry or similar) — race-day failures are currently console-only.
3. Publish the Google OAuth consent screen and verify login inside the installed iOS PWA.
4. Wire `VITE_SUPABASE_*` secrets into the GitHub Pages CI build.
5. Do the V1.1 "finish the seams" items before charging anyone: rider CRUD permissions and heat-start sync are the two a real multi-commissaire race will notice first.
6. Keep the two permission layers in lockstep: any change to `ROLE_PERMISSIONS` must land in the SQL policies in the same commit.
