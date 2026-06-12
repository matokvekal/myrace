# Commissaire App - Master Agent Blueprint

This document is the single source of truth for rebuilding this app from scratch.

If a new agent receives only this file, it should be able to:

1. Understand the full product and architecture.
2. Recreate the folder and module structure.
3. Rebuild core race workflows end to end.
4. Avoid known pitfalls and migration leftovers.

---

## 1) Product Purpose

Commissaire is a mobile-first race operations app for bike events.

Primary use cases:

- Create race events locally.
- Import riders from CSV.
- Auto-generate race categories from rider data.
- Run heats and category starts.
- Record lap passes live.
- Compute category and overall positions.
- Manage statuses: standing, running, finished, DNF, DNS, DSQ.
- Work offline using local persistence.

Design intent:

- Fast interactions for race officials under pressure.
- Phone-friendly controls.
- Offline-first reliability.

---

## 2) Current Stack

- Vite 6
- React 18
- TypeScript
- React Router v6
- Zustand + persist middleware
- IndexedDB via idb
- CSS Modules
- js-cookie
- PapaParse
- Zod
- dayjs

Build commands:

- npm install
- npm run dev
- npm run build
- npm run preview

---

## 3) App Entry and Routing

Main entry:

- src/main.tsx
  - Creates React root.
  - Wraps App with BrowserRouter.

Router:

- src/App.tsx
  - / -> HomePage
  - /login -> LoginPage
  - /otp -> OtpPage
  - /loginerror -> LoginErrorPage
  - /main -> MainPage
  - /contact -> ContactPage
  - /race/:id -> RacePage
  - /race/:id/heat/:heatId -> HeatPage
  - /race/:id/standing/:heatId -> StandingPage
  - - -> NotFoundPage

Behavior of root route:

- src/app/page.tsx redirects immediately to /main.
- App is usable without login.
- Login is optional through side menu.

---

## 4) High-Level Folder Map

Root:

- index.html
- vite.config.ts
- tsconfig.json
- package.json

Source:

- src/main.tsx
- src/App.tsx
- src/vite-env.d.ts
- src/app/

Inside src/app:

- globals.css
- page.tsx
- not-found.tsx
- config/
- constants/
- services/
- stores/
- types/
- utils/
- components/
- login/
- otp/
- loginerror/
- main/
- race/
- contact/
- splash/

Race area:

- src/app/race/[id]/
  - page.tsx
  - schedule/
  - riders/
  - results/
  - editRiders/
  - map/
  - info/
  - heat/[heatId]/
  - standing/[heatId]/
  - raceMode/
- src/app/race/components/
  - addRider/
  - buttons/
  - categoryCard/
  - headerHeat/
  - headerRace/
  - heatCard/
  - modals/
  - raceInfo/
  - riderCard/
  - standingCard/

---

## 5) Data Model Contracts

Defined in src/app/types/types.ts.

### RaceProps

Core race metadata.
Important keys:

- uuid (main identity used across app)
- status: upcoming | running | finished
- image (data url, absolute path, or image key)
- heat (string)
- optional isFavorite

### CategoryProps

Category per race and heat.
Important keys:

- raceUuid
- name
- heat
- laps
- lapsCounter
- color
- status: upcoming | running | finished
- startTime

### RiderProps

Rider race state and lap state.
Important keys:

- raceUuid
- bibNumber
- category
- heat
- totalLaps
- lapsCounter
- lapsDetails[]
- raceStatus: upcoming | running | finished
- status: standing | running | finished | DNF | DSQ | DNS
- timeStartRace, timeArrive
- position_start, position_category, position_race
- color
- viewOrder

Invariant rules to preserve:

1. RiderProps.raceUuid must always match parent race uuid.
2. RiderProps.category must match a category name for the same race.
3. RiderProps.heat should match selected wave/heat.
4. raceStatus and status can differ but must make sense.
5. lapsCounter should never exceed totalLaps unless explicit special rule is added.

---

## 6) State Management (Zustand)

### useDataStore (auth + app tab)

File: src/app/stores/appStore.ts

State:

- user
- token
- loginState
- activeTab

Actions:

- handleSignUp
- handleSendOtp
- getUser
- checkLogin
- setLoginState
- setActiveTab

Notes:

- Reads token from cookie and fallback localStorage key Allkids.
- Login is not mandatory for race operations.

### useRaceStore

File: src/app/stores/racesStore.ts

State:

- races[]

Actions:

- getRaces
- insertRace
- updateRace

Read priority:

1. Zustand memory
2. IndexedDB races store
3. API fallback (currently empty mock)

### useRiderStore

File: src/app/stores/ridersStore.ts

State:

- riders[]
- lastFetchedRaceUuid

Actions:

- getRiders
- getRidersByHeat
- getRidersByCategory
- addNewRider
- insertRiders
- updateRider
- updateAllRiders
- deleteRider

### useCategoryStore

File: src/app/stores/categoryStore.ts

State:

- categories[]

Actions:

- getCategories
- createCategoriesFromRiders
- updateRiderColor
- updateCategory

Important behavior:

- If categories absent for race, auto-creates from riders.
- Assigns colors from constants list and propagates to riders.

### useUIStore

File: src/app/stores/uiStore.ts

State:

- modals object
- filters object
- activeTab
- isRaceMode
- modalData

Actions:

- openModal
- closeModal
- closeAllModals
- openFilters
- closeFilters
- setRaceMode
- setActiveTab

---

## 7) Persistence Layer

IndexedDB helper:

- src/app/stores/indexDb/indexedDbHelper.ts

Database:

- name: commissireDb
- version: 7

Object stores:

- races (keyPath id)
- riders (keyPath id)
- categories (keyPath id)

Version error behavior:

- If VersionError occurs, db is deleted and recreated.

Rebuild requirement:

- Keep this fallback behavior or provide migration-safe equivalent.

---

## 8) Main Screens and Responsibilities

### Main page (/main)

File: src/app/main/page.tsx

Responsibilities:

- Fetch races.
- Compute rider counts per race from IDB.
- Search, sort, favorites filter.
- Render empty state or race cards.
- Open AddRace screen.

### Add race flow

Files:

- src/app/main/addRace/AddRace.tsx
- src/app/utils/saveRace.ts
- src/app/utils/insertRidersCsv.ts

Flow:

1. Fill race metadata.
2. Optional cover image upload.
3. Optional CSV file upload.
4. Save race into IDB and race store.
5. If CSV exists, parse and insert riders.

### Race details (/race/:id)

File: src/app/race/[id]/page.tsx

Responsibilities:

- Load race by uuid.
- Ensure categories exist (create from riders if needed).
- Render tabbed views: schedule, riders, results, edit, map, info.
- Switch to RaceMode when enabled.

### Heat live screen (/race/:id/heat/:heatId)

File: src/app/race/[id]/heat/[heatId]/page.tsx

Responsibilities:

- Filter riders by heat categories and category state.
- Record rider pass click with debounce guard.
- Update laps, timestamps, elapsed fields.
- Mark finished riders.
- Recalculate positions with calculatePosition utility.

Current known issue:

- Timer display on this page is static placeholder and needs a live timer model.

### Standing screen (/race/:id/standing/:heatId)

File: src/app/race/[id]/standing/[heatId]/page.tsx

Responsibilities:

- Category-focused rider management.
- Search/filter.
- Open category modal.
- Open add rider modal.
- Open status modal and apply DNF/DNS/DSQ etc.

---

## 9) RaceMode

File:

- src/app/race/[id]/raceMode/RaceMode.tsx

Submodules:

- StartManager
- CheckIn
- LiveBoard

### StartManager behavior

- Groups categories by startTime per wave.
- Supports 60-second countdown overlay.
- Starts all categories in a start slot.
- Sets race status running when first start occurs.
- Initializes rider race state for started categories.

### LiveBoard behavior

- Per-category live view.
- Uses calculatePosition utility for ordering.
- Shows top riders and summary counts.

---

## 10) Utility Layer

Key files:

- src/app/utils/calculatePosition.ts
- src/app/utils/insertRidersCsv.ts
- src/app/utils/saveRace.ts
- src/app/utils/clearRaceState.ts
- src/app/utils/timeUtils.ts
- src/app/utils/loginValidation.ts
- src/app/utils/storageUtils.ts

### calculatePosition.ts

- Excludes DNF/DNS/DSQ from active ranking.
- Sort key: laps desc, then arrival time asc.
- Assigns both category and race positions.

### insertRidersCsv.ts expected columns

- timeStartRace
- heat
- bibNumber
- position_start
- firstName
- lastName
- category
- team
- totalLaps

Default values on import:

- raceStatus: upcoming
- status: standing
- lapsCounter: 0
- positions start at 0 and recomputed in race flow

---

## 11) Services and API Reality

Files:

- src/app/services/Auth.ts
- src/app/services/fetchRaces.ts
- src/app/services/fetchRiders.ts
- src/app/config/index.ts

Current status:

- Auth endpoints are coded.
- Race and rider fetch services are currently mocked/empty.
- API endpoint strings in config are malformed (contain 111 fragments).

Practical implication:

- App currently runs local-first and does not depend on backend for core race management.

---

## 12) UI/UX Design System Snapshot

Global style source:

- src/app/globals.css

Current visual language:

- Light background, blue primary accents.
- Card-heavy layout.
- Mobile-first spacing and compact controls.

Core component styles:

- Race card in src/app/main/components/raceCard/
- Main toolbar/list in src/app/main/main.module.css
- Header and drawer in src/app/main/components/headerMain/

Rebuild objective:

- Preserve race-official clarity over decorative complexity.
- Keep touch targets large and quick to scan.

---

## 13) Known Technical Debt and Required Fixes

1. API endpoint config includes malformed urls.
2. Heat page timer placeholder needs real runtime timer logic.
3. Services fetchRaces/fetchRiders are stubs.
4. Large image assets should be optimized.
5. Some legacy migration files remain and should be either documented as legacy or removed.
6. Two CSV parsing styles exist; unify into one robust parser.
7. Missing test coverage for lap click and ranking correctness.

---

## 14) Build-From-Scratch Implementation Order

Use this order for a clean rebuild:

Phase A - Foundation

1. Create Vite React TS app.
2. Add routing and entry points.
3. Add global styles and constants.
4. Add full type contracts.

Phase B - Data and Persistence

1. Implement IndexedDB helper and stores.
2. Implement race/rider/category stores with persist.
3. Add utility functions for time and positions.

Phase C - Main Product Flow

1. Build /main race list and AddRace flow.
2. Build race detail shell and tabs.
3. Build rider import and category auto-creation.
4. Build heat click flow and ranking updates.

Phase D - Extended Ops

1. Build standing and status management.
2. Build RaceMode (StartManager, CheckIn, LiveBoard).
3. Add optional auth screens and side-menu actions.

Phase E - Hardening

1. Validate all edge cases for statuses and lap counts.
2. Add tests for calculatePosition and lap transitions.
3. Optimize assets and initial load.
4. Clean migration leftovers.

---

## 15) Acceptance Criteria for Rebuild

A rebuilt app is acceptable only if all are true:

1. App starts with npm run dev and builds with npm run build.
2. User can create a race and it persists across refresh.
3. User can import riders CSV and see riders in race pages.
4. Categories auto-generate from rider categories.
5. Starting category changes category and rider states correctly.
6. Clicking rider in heat increments lap and updates timings.
7. Position ranking updates consistently after each click.
8. Standing page can set DNF/DNS/DSQ.
9. Race list works with one race and many races.
10. App remains usable without server connectivity.

---

## 16) Security and Reliability Notes

- Never trust CSV data blindly; keep strict parsing and defaults.
- Avoid mutating shared objects in place where possible.
- Keep race operation logic deterministic to reduce officiating errors.
- Local persistence is critical; handle IndexedDB errors explicitly.

---

## 17) Developer Quick Reference

Commands:

- npm install
- npm run dev
- npm run build

Core files to inspect first:

- src/App.tsx
- src/app/main/page.tsx
- src/app/race/[id]/page.tsx
- src/app/race/[id]/heat/[heatId]/page.tsx
- src/app/stores/ridersStore.ts
- src/app/stores/categoryStore.ts
- src/app/utils/calculatePosition.ts
- src/app/utils/insertRidersCsv.ts

---

## 18) Final Guidance for Future Agents

When making changes:

1. Respect existing data contracts in types.ts.
2. Keep all race state transitions explicit and traceable.
3. Validate both UI state and persisted IDB state.
4. Prefer small safe refactors over broad rewrites during race logic changes.
5. Always verify with npm run build after changes.

This file intentionally prioritizes operational correctness and rebuildability over shortness.
