# Cloud Architecture

How the cloud layer works, layer by layer. For setup see `docs/cloud/2-setup-supabase.md`; for the file map see `docs/cloud/1-overview.md`; for security see `docs/cloud/5-security.md`.

---

## 1. Local-First

The mandatory data flow — never bypass IndexedDB:

```
React UI
   ↓
Race Engine (handleRiderClick, CheckIn, StartManager, …)
   ↓
Zustand (in-memory cache)
   ↓
IndexedDB  ←———— SOURCE OF TRUTH for the UI
   ↓
Sync Service (src/app/services/cloud/)
   ↓
Supabase (Postgres + Auth + Realtime)
```

Every user action:

```
User taps rider
   ↓
1. can() permission check              (permissions.ts — instant, in-memory)
   ↓
2. Local update                        (Zustand set + IndexedDB put — UNCHANGED original code)
   ↓
3. UI updates immediately              (no network wait, ever)
   ↓
4. recordRaceEvent()                   (event row → IndexedDB "race_events" store)
   ↓
5. Background push (fire-and-forget)   (pushPendingEvents → Supabase insert)
```

Steps 1–3 are the original app. Steps 4–5 are the overlay. If step 5 fails or there is no internet, nothing above it notices.

## 2. Event Flow

Events are the unit of sync. One event = one commissaire action.

```
RaceEvent {
  id            client uuid (crypto.randomUUID) — global dedupe key
  raceId        LOCAL race uuid (mapped to cloud uuid at push time)
  riderId/bib   who
  eventType     LAP_MARKED | RIDER_CHECKIN | DNF | DNS | UNDO | RIDER_EDITED
  lapNumber     for laps/undo
  eventTime     ISO timestamp of the action
  deviceId      stable per-device uuid (localStorage)
  syncStatus    local | pending | synced | rejected | conflict
  payload.riderPatch   resulting rider fields after the action
}
```

**The `riderPatch` trick:** the device that performs the action embeds the *result* (lapsCounter, lapsDetails, timeArrive, …). Receiving devices just merge the patch into their local rider — they never re-run lap timing math. This keeps devices consistent without a shared clock.

`syncStatus` lifecycle:

```
race not uploaded ──► "local"    (never pushed; terminal)
race uploaded     ──► "pending" ──push ok──► "synced"
                              └──unique/RLS violation──► "rejected"
```

## 3. Sync Flow

```
                         ┌───────────────────────────────┐
                         │           Supabase            │
                         │  races / riders / race_users  │
                         │        race_events            │
                         └───┬───────────▲───────────┬───┘
              pull history   │           │ insert    │ realtime INSERT
        (pullRemoteEvents)   │           │ (push)    │ (subscribeToRaceEvents)
                         ┌───▼───────────┴───────────▼───┐
                         │        cloudSync.ts           │
                         └───┬───────────▲───────────┬───┘
                   merge     │           │           │  applyRemoteEvent
                 riderPatch  │     getPending        │  (merge riderPatch)
                         ┌───▼───────────┴───────────▼───┐
                         │   IndexedDB (commissireDb v9) │
                         │   riders / races / race_events│
                         └───────────────▲───────────────┘
                                         │
                                   Zustand stores
```

- **Upload** (`uploadRaceToCloud`): race row (+ full `RaceProps` JSON in `payload`) + all riders (+ full `RiderProps` JSON in `payload`) + `CREATOR` row in `race_users`. Re-running updates the snapshots.
- **Download** (`downloadRaceFromCloud`): rebuilds local race + riders from the `payload` snapshots, links the race, then replays event history.
- **Push** (`pushPendingEvents`): single-flight (a `pushing` flag), groups pending events by race, maps local rider id → cloud rider uuid, inserts one by one.
- **Pull** (`pullRemoteEvents`): fetches all accepted events for the race ordered by `created_at`, skips ids already in IndexedDB, applies the rest.

## 4. Realtime

While a race screen is open (`useCloudRaceSync` on the race page and heat page):

```
supabase.channel("race-events-<cloudRaceId>")
  .on postgres_changes INSERT on race_events WHERE race_id = <cloudRaceId>
```

Handler per incoming row:
1. `status !== 'accepted'` → ignore.
2. Event id already in IndexedDB → ignore (this is how our own pushes echo back harmlessly).
3. Otherwise: save to IndexedDB (`synced`), merge `payload.riderPatch` into the local rider via `useRiderStore.updateRider` → UI re-renders.

Subscription is torn down on unmount (the hook returns the cleanup).

## 5. Offline Queue

- No connectivity check before local work — offline is the *default* assumption.
- `pushPendingEvents` early-returns when `navigator.onLine === false` and sets sync state to `offline` (Cloud tab shows "Offline — N saved locally").
- `attachOnlineListener()` (installed once in `App.tsx`) flushes all pending events on the browser `online` event.
- Additional flush triggers: every new event nudges a push; opening a race screen pushes; the Cloud tab has a manual **Sync now** button.
- Retry model: an event that fails with a *non-permission, non-duplicate* error stays `pending` and is retried on every future flush. `rejected` is terminal.

## 6. Conflict Handling (V1)

Rule: **for the same race + rider + lap number, the first accepted `LAP_MARKED` wins.**

Enforced by the database, not by clients:

```sql
create unique index unique_lap_event
  on race_events (race_id, rider_id, lap_number)
  where event_type = 'LAP_MARKED' and status = 'accepted';
```

The losing device gets Postgres error `23505`, marks its event `rejected`, and its local state converges when the winning event arrives via realtime/pull. There is no clock comparison and no merge logic to get wrong.

## 7. Permissions

See `docs/cloud/5-security.md` for the full model. Architectural points:

- `can()` is synchronous and in-memory — safe to call in a hot path like lap tapping.
- Roles are cached in `cloudStore.links` (persisted to localStorage) so permission checks work offline after the first login.
- Client checks are UX; Postgres RLS is enforcement. A hacked client can skip `can()` but cannot write to Supabase beyond its role.
- **A race with no cloud link has no permission system at all.** Local = full control. This is deliberate: the device owner owns their data.

## 8. Authentication

- Google OAuth via `supabase.auth.signInWithOAuth({ provider: "google" })` — full-page redirect, returns to `window.location.origin`.
- supabase-js persists the session in localStorage and auto-refreshes tokens (`autoRefreshToken: true`).
- `cloudStore.init()` (called once in `App.tsx`) subscribes to `onAuthStateChange`:
  - `INITIAL_SESSION` (startup restore) and `SIGNED_IN` (fresh login) both → `claim_race_invites()` RPC (attaches user_id to email invites, idempotent) → `refreshMyRoles()`.
  - Offline startup: session restores from localStorage without network; role refresh is skipped until online (cached `links` keep permissions working).
- Missing/expired session → `user: null` → cloud features show login buttons; local features unaffected.

## 9. Design Decisions Worth Knowing

| Decision | Why |
|---|---|
| JSON `payload` snapshots on races/riders instead of full column mapping | The local model (`RiderProps`, 30+ fields) evolves fast; snapshotting decouples cloud schema from app model. Typed columns exist only for what the server must query (bib, names, status). |
| Client-generated event ids | Global dedupe without a round trip; realtime echo suppression falls out for free. |
| Event log *alongside* rider snapshots (not event-sourcing the whole state) | Zero rewrite of the working race engine. Events sync actions; snapshots bootstrap new devices. |
| Lazy import `cloudSync` from `raceEvents` | Breaks a circular module dependency; also keeps the hot path free of supabase imports. |
| Only `links` persisted from cloudStore | The Supabase session already persists itself; duplicating it invites state drift. |
