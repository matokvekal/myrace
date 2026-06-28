# App Review — Commissaire Race Management
**Date:** 2026-06-27  
**Branch:** ver1  
**Reviewer:** Claude Code

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Bug List — Prioritized](#bug-list--prioritized)
3. [Code Quality Issues](#code-quality-issues)
4. [UI/UX Feedback](#uiux-feedback)
5. [Roadmap: Roles Phase](#roadmap-roles-phase)
6. [Roadmap: Sockets + Multi-User Phase](#roadmap-sockets--multi-user-phase)
7. [Roadmap: Database Migration](#roadmap-database-migration)

---

## Architecture Overview

| Layer | Technology | Notes |
|---|---|---|
| Framework | React + Vite + React Router v6 | Not Next.js despite `[id]` folder names |
| State | Zustand (no persist middleware — custom adapters) | |
| Persistence | IndexedDB via `idb` library | DB name: `commissireDb` v8 |
| Styling | CSS Modules | Per-component `.module.css` files |
| Auth | Token cookie + localStorage | RBAC schema exists in IDB but unused in UI |

**Data flow:** IDB is the source of truth → Zustand is the in-memory cache → Components read from Zustand.

Load sequence per page: `getRaces()` → `getCategories(raceUuid)` → `getRiders(raceUuid)`  
Each getter short-circuits if Zustand already has data — this is fast but can serve stale data.

---

## Bug List — Prioritized

### 🔴 Critical

#### BUG-01 — `timeStartRace` format mismatch breaks Results timing
**File:** `src/app/race/[id]/raceMode/StartManager.tsx` line 570  
**File:** `src/app/race/[id]/results/Results.tsx` line 33  

StartManager sets:
```ts
timeStartRace: new Date().toLocaleTimeString("en-GB")  // → "09:30:00"
```
Results.tsx then does:
```ts
new Date(rider.timeStartRace)  // new Date("09:30:00") → Invalid Date
```
**Effect:** All elapsed time calculations in Results are NaN. It only appears to "work" because `NaN` is falsy and falls through to the `—` display. No timing data ever shows for any race.

**Fix:**
```ts
// StartManager.tsx — store as ISO string
timeStartRace: new Date().toISOString()

// Heat page already handles both formats via parseTimeStr() — keep that
```

---

#### BUG-02 — IndexedDB VersionError silently wipes all race data
**File:** `src/app/stores/indexDb/indexedDbHelper.ts` lines 31–37  

```ts
request.onupgradeneeded = ...
request.onerror = (e) => {
  if (e.target.error?.name === "VersionError") {
    indexedDB.deleteDatabase(DB_NAME)  // ← deletes EVERYTHING
    initDB()
  }
}
```
Any version bump in development or a new deployment causes a silent full wipe.

**Fix:** Never delete on VersionError. Instead, show a user-facing error:
```ts
if (e.target.error?.name === "VersionError") {
  console.error("DB version mismatch — please clear app data manually")
  // optionally show a toast: "App update requires reset. Export your data first."
}
```
Long term: proper IDB migration with `onupgradeneeded` handling per version.

---

#### BUG-03 — `calculatePositions` mutates Zustand store objects
**File:** `src/app/utils/calculatePosition.ts` lines 33, 49  

```ts
rider.position_category = index + 1  // mutates in place
rider.position_race = index + 1
```
Called with `[...waveRiders]` (shallow clone) — the spread clones the array but not the objects inside. Position fields on Zustand store objects are silently overwritten on every LiveBoard render.

**Fix:**
```ts
// In calculatePosition.ts, return new objects
const ranked = sorted.map((rider, i) => ({ ...rider, position_category: i + 1 }))
```

---

### 🟠 High

#### BUG-04 — Schedule "un-finish" leaves stale timing on rider
**File:** `src/app/race/[id]/schedule/Schedule.tsx` line 555  

Toggling a finished rider back to "running":
```ts
updateRider({ ...rider, status: "running", raceStatus: "running" })
// Missing: timeArrive: undefined, elapsedTimeFromStart: undefined
```
Rider shows a finish time but has running status — confusing for commissaire.

**Fix:** Clear timing fields when reverting to running:
```ts
updateRider({
  ...rider,
  status: "running",
  raceStatus: "running",
  timeArrive: undefined,
  elapsedTimeFromStart: undefined,
})
```

---

#### BUG-05 — DSQ/DNS status toggles don't sync `raceStatus`
**File:** `src/app/race/[id]/schedule/Schedule.tsx` lines 562–578  

- Setting DSQ: updates `status` but NOT `raceStatus` → rider can appear "running" in LiveBoard while DSQ
- Un-DNS: sets `raceStatus: "upcoming"` instead of `"running"` → rider doesn't appear in heat view

**Fix:** Each status change must update both fields:
```ts
// DSQ
{ status: "DSQ", raceStatus: "finished" }
// Un-DSQ
{ status: "running", raceStatus: "running" }
// DNS
{ status: "DNS", raceStatus: "upcoming" }
// Un-DNS
{ status: "standing", raceStatus: "upcoming" }
```

---

#### BUG-06 — Duplicate `activeTab` across two stores
**File:** `src/app/stores/appStore.ts` and `src/app/stores/uiStore.ts`  

- `useDataStore.activeTab` (default `"riders"`) controls Race page tabs
- `useUIStore.activeTab` (default `"schedule"`) exists but race page ignores it
- Standing page calls `useUIStore.setActiveTab("heats")` which has zero effect on navigation

**Fix:** Delete `activeTab` from `uiStore`. Use only `useDataStore.activeTab`. Fix Standing page back button to call `useDataStore.setActiveTab("schedule")`.

---

#### BUG-07 — CheckIn wave filter ignores subCategory
**File:** `src/app/race/[id]/raceMode/CheckIn.tsx` line 26  

```ts
const waveCatNames = new Set(categories.map((c) => c.name))
// filtered = riders where rider.category IN waveCatNames
```
If wave has "Masters 30-39" and "Masters 40-49", both match on name "Masters" — all masters riders appear regardless of which wave they're in.

**Fix:** Filter by `name + subCategory` pair:
```ts
const waveCatKeys = new Set(categories.map((c) => `${c.name}::${c.subCategory ?? ""}`))
const filtered = riders.filter((r) => waveCatKeys.has(`${r.category}::${r.subCategory ?? ""}`))
```

---

### 🟡 Medium

#### BUG-08 — Category ID collision risk
**File:** `src/app/stores/categoryStore.ts` line 90  
**File:** `src/app/race/[id]/categories/Categories.tsx` line 107  

Pattern: `id: Date.now() + index` — if loop runs in < 1ms, two categories get the same ID.

**Fix:** Use a reliable unique ID:
```ts
id: Date.now() * 1000 + index  // spread IDs further
// or
id: crypto.randomUUID()  // best option — change id type to string in CategoryProps
```

---

#### BUG-09 — Double IDB write per lap
**File:** `src/app/race/[id]/heat/[heatId]/page.tsx` lines 190–191  

```ts
updateRider(updatedRider)       // write 1: single rider to IDB
updateAllRiders(finalSorted)    // write 2: all riders to IDB (supersedes write 1)
```
Two Zustand state updates + two IDB transactions fire for every lap click. On a 100-rider heat this creates contention.

**Fix:** Remove the `updateRider` call — `updateAllRiders` already includes the updated rider.

---

#### BUG-10 — Standing page category filter is a no-op
**File:** `src/app/race/[id]/standing/[heatId]/page.tsx` line 197  

```ts
selectCategory={(cat) => {
  useUIStore.getState().closeModal("showModalCategory")
  // ← never applies the filter
}}
```
Selecting a category just closes the modal without filtering.

**Fix:** Add state: `const [filterCat, setFilterCat] = useState<string | null>(null)` and apply it to the rider list.

---

#### BUG-11 — `getNowWave` picks by absolute time diff (past wave wins)
**File:** `src/app/race/[id]/riders/Riders.tsx` lines 35–57  

Uses `Math.abs(diff)` — a wave that started 5 minutes ago beats one starting in 10 minutes. During an active race this shows the wrong wave as "current".

**Fix:** Prefer the most recently started wave (smallest positive diff), falling back to the nearest future wave:
```ts
const pastWaves = waves.filter(w => diff >= 0).sort((a, b) => a.diff - b.diff)
const futureWaves = waves.filter(w => diff < 0).sort((a, b) => b.diff - a.diff)
return pastWaves[0] ?? futureWaves[0]
```

---

#### BUG-12 — `RiderLiveModal` saves comment with stale rider props
**File:** `src/app/race/[id]/heat/[heatId]/RiderLiveModal.tsx` line 30  

`onSaveComment(rider, comment)` uses the `rider` prop captured at modal open time. If status changes while modal is open, comment saves with old status.

**Fix:** Pass `riderId` to modal, look up fresh rider in store at save time:
```ts
const freshRider = useRiderStore.getState().riders.find(r => r.id === riderId)
onSaveComment(freshRider ?? rider, comment)
```

---

#### BUG-13 — No bib uniqueness check on rider add
**File:** `src/app/race/[id]/editRiders/EditRiders.tsx`  

Duplicate bib numbers can be entered. Bib is the primary identifier during live racing — duplicates cause wrong rider to receive lap credits.

**Fix:** On save, check `existingRiders.some(r => r.bib === newBib && r.id !== editingId)` and show validation error.

---

### 🔵 Low / Polish

#### BUG-14 — `getCategories` doesn't refresh after bank-add
**File:** `src/app/race/[id]/categories/Categories.tsx` line 139  

After `handleAddFromBank`, calls `getCategories(raceUuid)` which returns immediately from Zustand cache. New categories are in Zustand (via `updateCategory` calls) but not reflected in local component state.

**Fix:** Remove the `getCategories` call after bank-add. Instead, read directly from `useCategories` (which already reflects the update).

---

## Code Quality Issues

### Q-01 — `orgenizer` typo in `RaceProps`
**File:** `src/app/types/types.ts` line 33  
Rename to `organizer` — affects all places that read/write this field.

### Q-02 — Two competing persistence paths in rider store
`getRiders` (current) and `getRidersByOld` (legacy) both exist. Remove `getRidersOld`.

### Q-03 — `updateRiderColor` in categoryStore bypasses store actions
**File:** `src/app/stores/categoryStore.ts` lines 160–186  
Calls `useRiderStore.setState({ riders: updatedRiders })` directly. Should call `updateAllRiders(updatedRiders)` to keep IDB in sync.

### Q-04 — `Categories.tsx` uses `window.confirm()` for delete
**File:** `src/app/race/[id]/categories/Categories.tsx` line 202  
Blocking browser modal breaks on mobile. Replace with the existing `DeleteConfirmModal` pattern used elsewhere.

### Q-05 — Category templates stored in `localStorage`, riders in IDB
Templates survive a full IDB wipe (BUG-02) while all race data is lost. Should either both be in IDB or both in localStorage — right now they're split.

### Q-06 — `EditRiders.tsx` rider ID is a float
**File:** line 171: `id: Date.now() + Math.random()`  
Float IDs work in IDB but are non-standard. Use `crypto.randomUUID()` for string IDs (requires updating `RiderProps.id` type to `string`).

---

## UI/UX Feedback

### UX-01 — Race Mode entry/exit needs a confirmation
Toggling `isRaceMode` is instant — no confirmation. During a live race, an accidental toggle exits race mode (stops the clock view). Add a confirmation dialog.

### UX-02 — LiveBoard mutation is invisible
`calculatePositions` mutates objects silently (BUG-03). From a UX angle: position changes in LiveBoard have no animation. Add a brief CSS transition on position rank changes to make overtakes visible.

### UX-03 — Double-tap vs single-tap on touch is unreliable
**File:** `RacingRider.tsx` — 300ms window for double-tap.  
On slow devices or with gloves (cycling context!), 300ms is too short. Consider 400–500ms, or switch to a dedicated "long press" for the modal and single tap for lap.

### UX-04 — Heat page has no "undo" toast with cancel
When a lap is registered, `handleRevertLap` exists but is only accessible via the rider modal (double-tap). Add a brief (5s) toast with "Undo" button after each lap click — critical for accidental taps during fast finishes.

### UX-05 — Check-in has no quick filter by checked/unchecked
When 80 riders are in a wave, finding unchecked ones requires scrolling. Add a toggle: "Show unchecked only".

### UX-06 — No offline/sync status indicator
The app is offline-first but shows no indicator of sync state. Users don't know if they're working offline or if data has been uploaded. Add a status pill in the header.

### UX-07 — Category color editing requires two screens
To change a category color, user must go to Categories tab, find the category, edit. During live race setup this interrupts the flow. Allow quick color change from RaceMode category pill.

### UX-08 — Finished riders section in heat page can grow very large
All finished riders pile up at the bottom. Consider a collapsible panel: "Finished (12)" that expands on tap.

### UX-09 — Race card on main page shows rider count from separate IDB read
**File:** `src/app/main/page.tsx` lines 43–55  
The count is correct but there's no loading state — it flashes "0" then updates. Add a skeleton loader.

### UX-10 — Standing page back button broken (BUG-06 effect)
Back button calls `useUIStore.setActiveTab("heats")` which doesn't affect the Race page. Users navigate back via browser back button. Fix the store call to actually return to the correct tab.

---

## Roadmap: Roles Phase

The IDB schema already has `roles` and `users` stores (defined but empty in the UI).

### Proposed Role Model

```
OWNER         → full control: create race, edit riders, manage categories, start/end heats
COMMISSAIRE   → race-day control: check-in, lap recording, start heat, set DNF/DSQ/DNS
VIEWER        → read-only: LiveBoard, Results, Standing
```

### What Each Role Can Do

| Action | Owner | Commissaire | Viewer |
|---|---|---|---|
| Create/delete race | ✅ | ❌ | ❌ |
| Import CSV riders | ✅ | ❌ | ❌ |
| Edit categories | ✅ | ❌ | ❌ |
| Edit rider info | ✅ | ❌ | ❌ |
| Check in riders | ✅ | ✅ | ❌ |
| Start heat | ✅ | ✅ | ❌ |
| Record lap | ✅ | ✅ | ❌ |
| Set DNF/DSQ/DNS | ✅ | ✅ | ❌ |
| View LiveBoard | ✅ | ✅ | ✅ |
| View Results | ✅ | ✅ | ✅ |

### Implementation Plan

1. **Define `UserRole` type in `types.ts`:**
   ```ts
   type UserRole = "owner" | "commissaire" | "viewer"
   interface AppUser { id: string; name: string; phone: string; role: UserRole; raceUuid: string }
   ```

2. **Add `useRoleStore`** — wraps existing `roles`/`users` IDB stores. Expose `currentUser`, `currentRole`, `hasPermission(action)`.

3. **Gate actions with `hasPermission`:**
   - Wrap action buttons (Start, CheckIn, Lap tap) in a `<PermissionGuard role="commissaire">` component
   - `PermissionGuard` renders children or a locked/grayed version based on role

4. **Race access flow:**
   - Owner creates race → gets owner role automatically
   - Race has `isPrivate` + `password` (already in `RaceProps`) → commissaire enters password to join
   - Viewer gets read-only link (no password)

5. **UI changes needed:**
   - Add "Join Race" flow on main page (enter race ID + password → assigned commissaire role)
   - Add role badge in race header
   - Gray out / hide edit controls for non-owners

---

## Roadmap: Sockets + Multi-User Phase

### Goal
Multiple commissaires can record laps for the same heat simultaneously. Owner sees all their updates in real time.

### Architecture

```
Browser A (Owner)      Browser B (Commissaire 1)    Browser C (Commissaire 2)
     |                         |                           |
     └──────────────── WebSocket Server ──────────────────┘
                               |
                         PostgreSQL / SQLite
```

### Event Types (Socket Protocol)

```ts
// Client → Server
type ClientEvent =
  | { type: "LAP"; riderId: string; raceUuid: string; timestamp: string }
  | { type: "STATUS_CHANGE"; riderId: string; status: RiderStatus; raceUuid: string }
  | { type: "START_HEAT"; heatId: number; raceUuid: string; startTime: string }
  | { type: "CHECK_IN"; riderId: string; checked: boolean; raceUuid: string }

// Server → All clients in race room
type ServerEvent =
  | { type: "RIDER_UPDATED"; rider: RiderProps }
  | { type: "CATEGORY_UPDATED"; category: CategoryProps }
  | { type: "HEAT_STARTED"; heatId: number; startTime: string }
  | { type: "ERROR"; code: string; message: string }
```

### Conflict Resolution
Each rider update includes a `version` counter. Server rejects stale writes:
```
Client sends: { riderId, lapsCounter: 5, version: 4 }
Server checks: DB has version 4 → accept, increment to 5
Server checks: DB has version 5 (another client already wrote) → reject with CONFLICT error
Client receives CONFLICT → shows "Another commissaire already recorded this lap"
```

### Implementation Order
1. Add `version` field to `RiderProps` and `CategoryProps`
2. Build minimal WebSocket server (Node.js + `ws` or `socket.io`)
3. Replace direct `updateRider` calls with socket emit
4. Add optimistic UI: apply update locally immediately, roll back on CONFLICT
5. Add "connected users" indicator per race (shows how many commissaires online)

### Socket Hook (Sketch)
```ts
// src/app/hooks/useRaceSocket.ts
function useRaceSocket(raceUuid: string) {
  useEffect(() => {
    const ws = new WebSocket(`wss://your-server/race/${raceUuid}`)
    ws.onmessage = (e) => {
      const event: ServerEvent = JSON.parse(e.data)
      if (event.type === "RIDER_UPDATED") {
        useRiderStore.getState().updateRider(event.rider)
      }
    }
    return () => ws.close()
  }, [raceUuid])
  
  return {
    emitLap: (riderId: string) => ws.send(JSON.stringify({ type: "LAP", riderId, raceUuid }))
  }
}
```

---

## Roadmap: Database Migration

### Current Pain Points (IDB-only)
- Data lives only in one browser — no multi-device or multi-commissaire
- No backup — BUG-02 can wipe everything
- No server-side results export without manual Excel step
- Roles/users can't be shared between devices

### Recommended DB: PostgreSQL (via Supabase or self-hosted)

**Why Postgres:**
- Supabase gives real-time subscriptions (replaces socket server for some use cases)
- Row-level security maps directly to the role model
- Free tier sufficient for race-day load

### Schema Sketch

```sql
-- users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) UNIQUE,
  name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- races
CREATE TABLE races (
  uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200),
  date DATE,
  location VARCHAR(200),
  status VARCHAR(20) DEFAULT 'upcoming',
  organizer_id UUID REFERENCES users(id),
  distance DECIMAL,
  is_private BOOLEAN DEFAULT false,
  password_hash VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- race_members (role per race)
CREATE TABLE race_members (
  user_id UUID REFERENCES users(id),
  race_uuid UUID REFERENCES races(uuid),
  role VARCHAR(20) CHECK (role IN ('owner', 'commissaire', 'viewer')),
  PRIMARY KEY (user_id, race_uuid)
);

-- categories
CREATE TABLE categories (
  id BIGINT PRIMARY KEY,
  race_uuid UUID REFERENCES races(uuid),
  name VARCHAR(100),
  sub_category VARCHAR(50),
  laps INTEGER DEFAULT 0,
  start_time VARCHAR(5),
  color VARCHAR(7),
  heat INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'upcoming',
  linked_finish BOOLEAN DEFAULT false,
  finished_at BIGINT
);

-- riders
CREATE TABLE riders (
  id VARCHAR(50) PRIMARY KEY,  -- UUID string
  race_uuid UUID REFERENCES races(uuid),
  bib INTEGER,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  category VARCHAR(100),
  sub_category VARCHAR(50),
  club VARCHAR(200),
  status VARCHAR(20) DEFAULT 'standing',
  race_status VARCHAR(20) DEFAULT 'upcoming',
  laps_counter INTEGER DEFAULT 0,
  total_laps INTEGER DEFAULT 0,
  time_start_race TIMESTAMPTZ,
  time_arrive TIMESTAMPTZ,
  position_category INTEGER,
  position_race INTEGER,
  color VARCHAR(7),
  version INTEGER DEFAULT 0,  -- for conflict resolution
  UNIQUE(race_uuid, bib)      -- enforces BUG-13 fix at DB level
);

-- lap_details
CREATE TABLE lap_details (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rider_id VARCHAR(50) REFERENCES riders(id),
  lap INTEGER,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  lap_time VARCHAR(20),
  position INTEGER,
  speed_kph DECIMAL
);
```

### Migration Strategy
1. Keep IDB as local cache (offline support)
2. Add sync layer: on connect, push local IDB changes to Postgres; on reconnect, pull server changes
3. Use `syncedAt` / `serverVersion` fields already in `RaceProps` for conflict detection
4. Gradually move source of truth from IDB → Postgres

---

## Quick Fix Priority Order

For the next sprint, fix in this order:

| # | Bug | Effort | Impact |
|---|---|---|---|
| 1 | BUG-01 `timeStartRace` ISO format | 5 min | 🔴 Results broken for all races |
| 2 | BUG-05 DSQ/DNS raceStatus sync | 15 min | 🔴 Riders disappear from heat view |
| 3 | BUG-04 Un-finish clears timing | 10 min | 🟠 Data corruption |
| 4 | BUG-03 calculatePositions mutation | 20 min | 🟠 Silent state corruption |
| 5 | BUG-07 CheckIn subCategory filter | 15 min | 🟠 Wrong riders in check-in |
| 6 | BUG-06 Duplicate activeTab | 30 min | 🟡 Dead code + broken back button |
| 7 | BUG-09 Double IDB write | 5 min | 🟡 Performance |
| 8 | BUG-13 Bib uniqueness check | 20 min | 🟡 Data integrity |
| 9 | BUG-02 IDB VersionError wipe | 30 min | 🔴 Risk (hit on any version bump) |
| 10 | UX-04 Undo toast after lap | 1h | 🟠 Critical for commissaire UX |
