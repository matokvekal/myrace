# Production Checklist

Everything to verify before running real races on the cloud layer, and before any commercial launch. Items marked ☐ are open; ☑ are done in code as of 2026-07-04.

## Database
- ☑ All tables have PKs, FKs with `on delete cascade`, CHECK constraints on enums
- ☑ Partial unique index enforces duplicate-lap rule at the DB level
- ☑ `updated_at` triggers on races/riders
- ☐ Run `explain analyze` on `my_race_role()` under load (it executes inside every RLS check — indexes `race_users_user_idx` / `race_users_email_idx` should keep it <1ms)
- ☐ Decide data retention: races older than N months → archive/delete policy
- ☐ Point-in-time recovery / daily backups enabled in Supabase plan (free tier: 7-day backups — verify acceptable)

## Security
- ☑ RLS enabled on all 5 tables; no client path uses service_role
- ☑ Events immutable (no update/delete policies)
- ☑ `created_by = auth.uid()` enforced on event insert
- ☑ SECURITY DEFINER functions pin `search_path`
- ☐ Re-test the full permission matrix after ANY policy change (`docs/cloud/3-testing.md` Part 6)
- ☐ Review Supabase Auth rate limits for login abuse
- ☐ Google OAuth consent screen published (not "Testing" mode) before real users

## Authentication
- ☑ Google login, logout, session restore, token auto-refresh, offline startup
- ☐ Production URLs in Supabase Redirect URLs AND Google authorized redirect URI
- ☐ Test login on iOS Safari standalone PWA (OAuth redirects in installed PWAs are historically fragile)

## Performance
- ☑ Permission checks synchronous/in-memory (no network in lap hot path)
- ☑ Event push is fire-and-forget, single-flight
- ☐ Load test: 300 riders × 8 laps ≈ 2,400 events per race — verify pull time on race open stays acceptable (index exists; consider `created_at > lastSyncedAt` incremental pull in V1.1)
- ☐ Bundle: main chunk >1.6MB (pre-existing) — code-split supabase-js + map libs

## Offline
- ☑ IDB-first writes; pending queue; `online` listener flush; manual Sync now
- ☐ Two-device offline scenarios executed (`docs/cloud/3-testing.md` Part 5) — **blocking**
- ☐ Verify PWA service worker doesn't cache-poison `.env`-injected values after redeploys

## Realtime
- ☑ Per-race channel, INSERT-filtered, deduped by event id, torn down on unmount
- ☐ Supabase free tier: 200 concurrent realtime connections — enough for early use; plan limit for SaaS
- ☐ Reconnect behavior after long sleep (phone locked mid-race) — verify channel resubscribes; if not, add visibilitychange → pull

## Error handling & logging
- ☑ Every cloud call catches; failures degrade to local + console.warn
- ☐ Surface `rejected` events to users (V1.1 — currently silent in console/IDB)
- ☐ Add remote error reporting (e.g. Sentry) before commercial launch — console-only today

## Deployment
- ☐ `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` added to GitHub Pages build (CI secret → `.env.production`), see `docs/github-pages.md`
- ☐ Confirm SPA-routing 404 trick still covers the OAuth return path
- ☑ `.env.local` git-ignored; `.env.example` committed; no secrets in repo

## Monitoring
- ☐ Supabase dashboard: enable log drains / set usage alerts (DB size, auth users, realtime peak)
- ☐ Define the "race day incident" runbook: what to do if cloud is down mid-race → answer: nothing breaks, everyone works local; merge happens on recovery. Write this into the user-facing help.

## Before charging money (SaaS gate)
- ☐ Terms of service + privacy policy (rider PII lives in `riders.payload`)
- ☐ GDPR-style delete: cascade covers DB; add "delete my account" flow
- ☐ Subscription/entitlement checks server-side (new `plans` table + RLS), never client-side
- ☐ Self-hosting story: schema is plain Postgres + the SQL file already; document `supabase start` local stack
