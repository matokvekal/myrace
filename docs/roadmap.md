# Commissaire — Feature Roadmap

**Last Updated:** 2026-07-25

---

## Phase 1 — Bug Fixes (Current Priority)

Fix these before starting new features. Full details now live in `BUGS.md` item 6
(`docs/app-review.md`, the original source, was retired — its content was
transcribed there and here).

### Critical (do first)
- [x] **BUG-01** — Fix `timeStartRace` format — **fixed**, confirmed by code read
  (`StartManager.tsx` no longer stores `"HH:MM:SS"` via `toLocaleTimeString`).
- [ ] **BUG-02** — IDB VersionError handler must NOT delete the database. Show user error instead.
  - File: `src/app/stores/indexDb/indexedDbHelper.ts` lines 31–37
- [ ] **BUG-03** — `calculatePositions` must return new objects instead of mutating input —
  **confirmed still open**, `rider.position_category = index + 1` still mutates directly
  (`utils/calculatePosition.ts` L61).
- [ ] **BUG-05** — DSQ/DNS toggles must sync `raceStatus` field — **confirmed still open**,
  DSQ toggle sets `status` only (`race/[id]/schedule/Schedule.tsx` ~L706-728).

### High
- [ ] **BUG-04** — Un-finish a rider: clear `timeArrive` and `elapsedTimeFromStart`.
- [ ] **BUG-07** — CheckIn wave filter: match by `name + subCategory`, not just `name`.
- [ ] **UX-04** — Add 5-second "Undo" toast after every lap click in heat page.
- [ ] **BUG-13** — Add bib uniqueness validation when adding/editing riders — **confirmed
  still open**, no uniqueness check anywhere in `EditRiders.tsx`.

### Medium
- [ ] **BUG-06** — Remove duplicate `activeTab` from `uiStore`, use only `appStore`. Fix Standing back button.
- [ ] **BUG-08** — Replace `Date.now() + index` IDs with `crypto.randomUUID()` for categories.
- [ ] **BUG-09** — Remove double IDB write per lap (delete `updateRider` call, keep `updateAllRiders`).
- [x] **BUG-10** — Standing page category filter modal — **fixed**, confirmed by code read
  (`selectCategory` now calls `setSelectedCategory(...)` before closing the modal).
- [ ] **BUG-11** — `getNowWave` in Riders tab: use most-recently-started heuristic, not absolute diff.

---

## Phase 2 — Roles System

**Goal:** Owner and Commissaire roles with separate permissions. Same race, different access levels.

### User Stories
- As **Owner**: I can create a race, import CSV riders, edit categories, and manage all settings.
- As **Commissaire**: I can check in riders, start a heat, record laps, and set DNF/DSQ/DNS. I cannot edit race structure.
- As **Viewer**: I can see LiveBoard, Results, and Standing (read-only link, no login needed).

### Implementation Checklist
- [ ] Add `UserRole = "owner" | "commissaire" | "viewer"` to `types.ts`
- [ ] Add `AppUser { id, name, phone, role, raceUuid }` to `types.ts`
- [ ] Create `useRoleStore` — wraps existing `roles` / `users` IDB stores (schema already defined)
- [ ] Build `hasPermission(action)` helper — returns bool based on `currentRole`
- [ ] Build `<PermissionGuard role="commissaire">` component — renders locked/hidden UI for lower roles
- [ ] Gate all write actions behind `PermissionGuard`:
  - Owner-only: CSV import, delete race, edit categories, edit rider info
  - Commissaire+: check-in, start heat, lap click, DNF/DSQ/DNS
- [ ] Add "Join Race" flow on main page:
  - Input: race ID + password → system assigns `commissaire` role
  - Uses existing `isPrivate` + `password` fields on `RaceProps`
- [ ] Add role badge to race header
- [ ] Add "Invite Commissaire" button for owner (generates join link or shows race ID + password)

### Key Files to Modify
- `src/app/types/types.ts` — add role types
- `src/app/stores/` — add `roleStore.ts`
- `src/app/race/[id]/raceMode/CheckIn.tsx` — gate with PermissionGuard
- `src/app/race/[id]/raceMode/StartManager.tsx` — gate start actions
- `src/app/race/[id]/heat/[heatId]/page.tsx` — gate lap recording
- `src/app/race/[id]/categories/Categories.tsx` — owner-only
- `src/app/race/[id]/riders/Riders.tsx` — gate import/delete

---

## Phase 3 — Real-Time Multi-User (Sockets)

**Goal:** Multiple commissaires record laps simultaneously for the same heat, all see each other's updates live.

**Prerequisite:** Phase 2 (Roles) must be done first.

### Architecture
```
Browser (Owner)        Browser (Commissaire 1)    Browser (Commissaire 2)
      |                        |                          |
      └────────────── WebSocket Server ──────────────────┘
                               |
                          Database (Phase 4)
```

### Socket Events

**Client → Server:**
- `LAP` `{ riderId, raceUuid, timestamp, version }`
- `STATUS_CHANGE` `{ riderId, status, raceUuid }`
- `START_HEAT` `{ heatId, raceUuid, startTime }`
- `CHECK_IN` `{ riderId, checked, raceUuid }`

**Server → All clients in race room:**
- `RIDER_UPDATED` `{ rider: RiderProps }`
- `CATEGORY_UPDATED` `{ category: CategoryProps }`
- `HEAT_STARTED` `{ heatId, startTime }`
- `ERROR` `{ code, message }` — e.g., conflict

### Conflict Resolution
Add `version: number` to `RiderProps`. Server increments version on every write.  
Client sends current version → server rejects if version is stale → client shows "Lap already recorded by another commissaire".

### Implementation Checklist
- [ ] Add `version: number` to `RiderProps` and `CategoryProps`
- [ ] Build Node.js WebSocket server (`socket.io` or `ws` + Express)
- [ ] Add race "rooms" — each race UUID is a room
- [ ] Replace direct `updateRider` calls with `ws.emit("LAP", ...)` in `heat/[heatId]/page.tsx`
- [ ] Apply optimistic update locally, roll back on CONFLICT event
- [ ] Build `useRaceSocket(raceUuid)` hook — manages connection + event handlers
- [ ] Add "● X online" indicator to race header (shows connected commissaire count)
- [ ] Add reconnect logic with exponential backoff
- [ ] Sync local IDB with server state on reconnect (diff + merge)

---

## Phase 4 — Database

**Goal:** Persistent server-side storage. Enables multi-device, backup, and multi-user.

**Prerequisite:** Phase 3 (Sockets) infrastructure in place.

### Recommended Stack
- **Supabase** (hosted Postgres + real-time subscriptions + auth)  
  OR self-hosted PostgreSQL + Node.js API

### Why Supabase
- Built-in real-time (can replace or complement socket layer)
- Row-level security maps directly to role model (Phase 2)
- Free tier handles race-day load easily
- Auth built-in (replaces current cookie/localStorage token approach)

### Migration Strategy
1. Keep IDB as local cache (offline support remains)
2. Add sync layer: on connect, push IDB changes to Postgres; on reconnect, pull server changes
3. Use existing `syncedAt` / `serverVersion` fields on `RaceProps` for conflict detection
4. Gradually move source of truth from IDB → Postgres

### Schema — Key Tables
See `docs/app-review.md` → "Roadmap: Database Migration" for full SQL schema.

Tables: `users`, `races`, `race_members`, `categories`, `riders`, `lap_details`

### Implementation Checklist
- [ ] Set up Supabase project
- [ ] Run schema migrations
- [ ] Build sync service: `src/app/services/syncService.ts`
- [ ] Replace current API calls in stores with Supabase client calls
- [ ] Enable Supabase real-time on `riders` table → can replace or simplify socket layer
- [ ] Migrate auth to Supabase Auth (phone OTP already matches their flow)
- [ ] Add offline mode indicator + manual sync button

---

## Phase 5 — Polish & Export

**Goal:** Clean up UX, improve race-day reliability, add export features.

### Features
- [ ] **Excel export** — race results to `.xlsx` for federation submission (see `memory/project_excel_export.md`)
- [ ] **Full-app UI translation (i18n)** — infra (`react-i18next`, lazy-loaded
  `public/locales/<lng>/common.json`, language switcher in `HeaderMain`) shipped
  for the Scan Start List "Soon" strings only; the other ~150+ files/1000+
  hardcoded UI strings still need `t()` calls, migrated incrementally file by
  file, not in one pass — see `src/app/i18n/i18n.ts` for the pattern to follow.
- [ ] **PDF results** — printable results sheet per category
- [ ] **Public results URL** — shareable read-only standing page (Viewer role link)
- [ ] **QR code check-in** — rider scans QR → auto-checks in
- [ ] **Offline PWA** — install as app on iPad used at finish line
- [ ] **Dark/light theme** — `useTheme` hook already exists, just needs UI toggle in header
- [ ] **Undo toast** (UX-04) — if not done in Phase 1
- [ ] **Animated position changes** in LiveBoard (UX-02)
- [ ] **Long press** instead of double-tap for rider modal (UX-03 — 400–500ms)
- [ ] **Collapsible finished section** in heat page (UX-08)
- [ ] **Race Mode entry/exit confirmation** (UX-01) — toggling `isRaceMode` is instant today;
  confirm before an accidental toggle exits race mode mid-race.
- [ ] **Check-in "show unchecked only" filter** (UX-05) — for waves with 80+ riders.
- [ ] **Sync status indicator** (UX-06) — IndexedDB is the source of truth during a race, not
  the server; every tap/lap must save locally first, sync to server only when connectivity
  returns. Show the user a clear state: "Saved locally" / "Waiting for sync" / "Synced." Don't
  rely on Background Sync alone — WebKit can evict site data under storage pressure or long
  disuse, so a live race's only copy must never sit local-only indefinitely. Verify real sync
  behavior on an actual iPhone, not just Chrome DevTools' emulated offline mode.
- [ ] **Quick category color change from RaceMode pill** (UX-07) — avoid the
  Categories-tab round trip during live race setup.
- [ ] **Race card loading skeleton** (UX-09) — main page's rider count flashes "0" before
  the real IDB read resolves.
- [ ] **Code-quality cleanup carried over from the old app review**: rename `orgenizer` →
  `organizer` in `RaceProps` (breaking — touches every read/write site); remove the legacy
  `getRidersOld` path now that `getRiders` is the only caller; `categoryStore`'s
  `updateRiderColor` should call `updateAllRiders(...)` instead of writing
  `useRiderStore.setState(...)` directly; replace `Categories.tsx`'s `window.confirm()` delete
  with the existing `DeleteConfirmModal` pattern; decide whether category templates
  (localStorage) should move into IDB now that they survive a wipe that riders don't (BUG-02);
  `EditRiders.tsx`'s float rider IDs (`Date.now() + Math.random()`) work in IDB but are
  non-standard — candidate for `crypto.randomUUID()` alongside the BUG-08 category-ID fix.