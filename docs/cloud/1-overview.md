# Cloud Sync, Roles & Permissions (Supabase)

**Last Updated:** 2026-07-04 (Stage 2)
**Status:** Stage 1 + Stage 2 code complete, build passing. Blocked on: Supabase project provisioning (user) + executing the two-device test plan.

This doc is the entry point for the per-race cloud system. Read this before touching anything under `src/app/services/cloud/`.

Stage 2 documentation suite:
- `docs/cloud/2-setup-supabase.md` — build the backend from zero (~15 min)
- `docs/cloud/4-architecture.md` — layers, event flow, sync, realtime, offline, diagrams
- `docs/cloud/5-security.md` — auth, RLS, permission matrix, threat notes
- `docs/cloud/6-database.md` — every table, ER diagram, schema change log
- `docs/cloud/3-testing.md` — two-device test plan (NOT yet executed)
- `docs/cloud/7-production-checklist.md` — go-live gates
- `docs/cloud/8-roadmap.md` — V1 / V1.1 / V2
- `docs/cloud/9-stage2-summary.md` — final Stage 2 report

---

## The Golden Rule: Local-First

**The app must always work with no internet, no login, no Supabase config.**

Every cloud feature is an *overlay* on the existing local flow:

| Situation | Behavior |
|---|---|
| No `VITE_SUPABASE_URL` in env | All cloud code no-ops. Cloud tab shows "not configured". App = 100% local, unchanged. |
| Configured but not logged in | Local races work fully. "Sign in with Google" buttons appear. |
| Logged in, race never uploaded | Race is "local only" — full control, no permission checks, events saved with `syncStatus: "local"` (never pushed). |
| Race uploaded to cloud | Permission checks activate based on my role in `race_users`. Events are `pending` → pushed → `synced`. |
| Offline during a cloud race | Everything keeps working from IndexedDB. Events queue as `pending`. `window.online` event triggers push. |

**Never add a cloud call in the critical path of lap marking.** Event recording is fire-and-forget (`void recordRaceEvent(...)` after the local update already happened).

---

## Architecture

```
UI action (e.g. tap rider)
   │
   ├─ 1. can() permission check  (throw/toast if role forbids)
   ├─ 2. existing local update   (Zustand + IndexedDB — UNCHANGED code)
   └─ 3. recordRaceEvent()       (event → IDB "race_events" store → nudge push)
                                          │
                              pushPendingEvents() ──insert──▶ Supabase race_events
                                                                    │ realtime
        applyRemoteEvent() ◀── subscribeToRaceEvents() ◀───────────┘
        (merge riderPatch into local rider via useRiderStore.updateRider)
```

- **IndexedDB stays the source of truth for the UI.** Supabase is the sync bus between commissaires.
- Events carry a `payload.riderPatch` — the resulting rider fields after the action. Remote devices just merge the patch; they never re-run lap math.
- Conflict rule V1: DB partial unique index — for the same race+rider+lap only the **first accepted `LAP_MARKED` wins**; the loser's insert fails with `23505` and the local event is marked `rejected`.
- Dedupe: event `id` is a client `crypto.randomUUID()`. Realtime handler ignores events already in IDB (that's how our own events echo back harmlessly).

---

## File Map (what was added / changed)

### New files

| File | What it is |
|---|---|
| `src/app/types/cloud.types.ts` | `RaceRole`, `Permission`, `RaceEventType`, `SyncStatus`, `RaceEvent`, `RaceUserEntry`, `CloudRaceLink`, `CloudUser` |
| `src/app/services/cloud/permissions.ts` | `ROLE_PERMISSIONS` map, `can(user, raceId, permission)`, `canForRace()`, `assertCan()` |
| `src/app/services/cloud/supabaseClient.ts` | Null-safe singleton client. `isCloudConfigured()`, `getSupabase()`, `getDeviceId()` |
| `src/app/services/cloud/raceEvents.ts` | `recordRaceEvent()` — writes event to IDB first, then nudges push (lazy import avoids circular dep) |
| `src/app/services/cloud/cloudSync.ts` | The big one: `uploadRaceToCloud`, `downloadRaceFromCloud`, `pushPendingEvents`, `pullRemoteEvents`, `subscribeToRaceEvents`, `applyRemoteEvent`, `inviteUserToRace`, `listRaceUsers`, `removeRaceUser`, `attachOnlineListener` |
| `src/app/stores/cloudStore.ts` | Zustand: `user`, `syncState`, `links` (localRaceUuid → {cloudId, myRole}), `myCloudRaces`, Google sign-in/out, `refreshMyRoles()`. Only `links` persisted (localStorage `cloud-storage`) so roles survive offline restarts |
| `src/app/hooks/useRacePermission.ts` | Reactive `can()` for components: `const { can, role, isCloudLinked } = useRacePermission(raceUuid)` |
| `src/app/hooks/useCloudRaceSync.ts` | Mount on any race screen: init + pull + push + realtime subscribe. No-op for local races |
| `src/app/components/cloud/RaceCloudPanel.tsx` (+`.module.css`) | The "Cloud" tab: login, upload race, sync status badge, invite users (email + role), user list |
| `src/app/components/cloud/CloudRacesSection.tsx` | "Shared with me" section on main page — invited users download races from here |
| `supabase/migrations/0001_cloud_schema.sql` | Full DB: tables, RLS policies, `my_race_role()`, `claim_race_invites()`, unique lap index, realtime publication |
| `.env.example` | Template for `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` |

### Modified files (all changes are additive)

| File | Change |
|---|---|
| `src/app/stores/indexDb/indexedDbHelper.ts` | `DB_VERSION` 8→9; new `race_events` object store (indexes `byRace`, `bySyncStatus`); helpers `putRaceEventInDb`, `getRaceEventsFromDb`, `getPendingEventsFromDb`, `raceEventExistsInDb`, `setRaceEventStatusInDb` |
| `src/app/race/[id]/page.tsx` | Added `cloud` tab → `<RaceCloudPanel>`; `useCloudRaceSync(raceUuid)`; `DELETE_RACE` guard on Info delete |
| `src/app/race/[id]/heat/[heatId]/page.tsx` | `MARK_LAP` guard + `LAP_MARKED` event in `handleRiderClick`; `UNDO_EVENT` guard + `UNDO` event in `handleRevertLap`; `MARK_DNF`/`MARK_DNS` guards + events in `handleStatusChange`; `useCloudRaceSync(raceUuid)` |
| `src/app/race/[id]/raceMode/CheckIn.tsx` | `CHECKIN_RIDER` guard + `RIDER_CHECKIN` events in `toggleCheck` / `checkAll` |
| `src/app/main/page.tsx` | `<CloudRacesSection />` in home view AND in empty-state view (invited users start with zero local races) |
| `src/vite-env.d.ts` | Typed the env vars |
| `package.json` | Added `@supabase/supabase-js` |
| `src/App.tsx` | (Stage 2) app-root `cloudStore.init()` + `attachOnlineListener()` — session restores on startup, not only when visiting race screens |
| `src/app/stores/cloudStore.ts` | (Stage 2) invite claiming + role refresh also on `INITIAL_SESSION` (restored sessions), skipped while offline |

### Legacy files — do NOT confuse with the new system

`src/app/types/rbac.types.ts`, `src/app/stores/authStore.ts`, `src/app/stores/rbacStore.ts`, `src/app/hooks/useAuth.ts`, `src/app/components/auth/PermissionGate.tsx`, `src/app/components/admin/AdminPanel.tsx`, `src/app/services/RaceSync.ts` (localStorage mock), `src/app/services/Auth.ts` — these are an **older token-based experiment**, left untouched so nothing breaks. The new per-race system supersedes them. They can be removed in a cleanup pass once nothing imports them.

---

## Roles & Permissions

```
CREATOR       everything, incl. delete race + manage users (the uploader)
ADMIN         everything, incl. delete race + manage users
MANAGER       everything EXCEPT delete race / manage users
RIDER_MANAGER add/edit/delete riders (+ view, export)
CHECKIN       mark rider check-in (+ view)
FINISH_JUDGE  mark laps, DNF/DNS, undo (+ view, export)
VIEWER        read only (+ export)
```

Permission strings: `VIEW_RACE, EDIT_RACE, DELETE_RACE, MANAGE_USERS, ADD_RIDER, EDIT_RIDER, DELETE_RIDER, CHECKIN_RIDER, MARK_LAP, MARK_DNF, MARK_DNS, UNDO_EVENT, EXPORT_RESULTS`

`can()` resolution order:
1. Race has no `CloudRaceLink` → **true** (pure local race, owner of the device owns the data)
2. Link exists with `myRole` → check `ROLE_PERMISSIONS[role]`
3. Link exists, role unknown → only `VIEW_RACE`

Client checks are **UX only** — real enforcement is Supabase RLS (see the SQL file: per-event-type insert policies on `race_events`, role-gated writes everywhere).

Note: **DSQ** has no own event type — it's sent as event type `DNF` with the real status (`DSQ`) inside `payload.riderPatch.status`, and gated by `MARK_DNF`.

---

## Supabase Setup (one-time, manual — NOT done yet)

1. Create a project at supabase.com.
2. **Auth → Providers → Google**: enable, add OAuth client ID/secret from Google Cloud Console (authorized redirect: `https://<project>.supabase.co/auth/v1/callback`). Add the app origin(s) to Auth → URL Configuration → Redirect URLs (e.g. `http://localhost:3000`, the GitHub Pages URL).
3. **SQL editor**: run `supabase/migrations/0001_cloud_schema.sql` in full.
4. Copy Project URL + anon key → `.env.local`:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
5. Restart `npm run dev`.

## The Sharing Flow (how it's meant to be used)

1. Commissaire A creates/runs a race locally (nothing new required).
2. A opens the race → **Cloud tab** → Sign in with Google → **Upload race to cloud**. A becomes `CREATOR`.
3. A invites `b@gmail.com` as `FINISH_JUDGE` (email + role → `race_users` row, `user_id` null).
4. B opens the app on their device → main page → **Shared with me** → Sign in with Google. On login the app calls `claim_race_invites()` (RPC) which attaches B's user_id to the invite, then `refreshMyRoles()` lists the race.
5. B clicks **Download** → local copy created from the `payload` snapshots → B lands on the race page.
6. Both open the live heat screen. `useCloudRaceSync` pulls history + subscribes realtime. B's lap taps: local update → event push; A's device receives it via realtime → `applyRemoteEvent` merges the `riderPatch`.
7. Offline taps queue as `pending` ("N waiting to sync" badge in Cloud tab; "Sync now" button) and flush on reconnect.

---

## What is NOT done yet (next steps, in order)

1. **Runtime verification** — build (`tsc` + `vite build`) passes, but the flow was not yet driven in a browser. Verify: local flow untouched, Cloud tab renders, then (after Supabase setup) the full two-device flow. A Playwright drive script sketch exists from the first attempt (drive main → race → cloud tab → heat → click rider → assert IDB `race_events` row).
2. **Rider CRUD guards** — `ADD_RIDER`/`EDIT_RIDER`/`DELETE_RIDER` checks are NOT yet wired into the riders/editRiders screens, and rider edits don't emit `RIDER_EDITED` events. RLS still blocks unauthorized cloud writes, and local races are unaffected — but a VIEWER's UI won't stop rider edits on their local copy yet.
3. **StartManager** — starting a heat (`timeStartRace` on all riders) doesn't emit events; a second device won't see the race start in real time until riders sync. Consider a `RACE_STARTED` event type or rider upsert on start.
4. **Rider snapshot re-upload** — riders added after upload only reach the cloud on "Update cloud copy". Auto-upsert new riders on change would be better.
5. **Categories** are only in the race `payload` snapshot, not their own table — fine for V1.
6. **Conflict UI** — `rejected` events are silent; V2 could show them in the action log.
7. **Legacy cleanup** — remove old rbac/auth experiment files once confirmed unused.

## Gotchas learned during implementation

- **Pre-existing, unrelated:** `npx tsc` fails with TS1261 — `racingRider.tsx` on disk vs `RacingRider.tsx` in git/imports (Windows casing). It exists on the clean tree too; `vite build` succeeds anyway. Fix by `git mv racingrider… RacingRider.tsx` some day.
- `.gitignore` covers `.env.local` (use that, not `.env`).
- Circular dep: `raceEvents.ts` → `cloudSync.ts` is a **lazy dynamic import** on purpose.
- Zustand persist on `cloudStore` deliberately stores **only `links`** — the Supabase session itself is persisted by supabase-js in localStorage.
- RLS on `race_users` uses the `my_race_role()` SECURITY DEFINER function to avoid infinite policy recursion — don't inline that subquery into the policies.
- IDB `VersionError` handler still deletes everything (BUG-02) — bumping to v10+ later is fine, but that bug should be fixed first.
