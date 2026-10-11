> Completed items were removed to keep this file to OPEN work only. Their
> write-ups live in git history and the feature notes are in CLAUDE.md. Below is
> only what's left to do, renumbered 1..N in working order.

---
## OPEN ITEMS  (updated 2026-07-22)

| #  | Item | Priority | Status |
|----|------|----------|--------|
| 1 | ESLint broken project-wide (extends a Next.js preset in a Vite app) | 🟡 tooling | 🆕 TODO — needs OK to add dev-deps |
| 2 | Demo race redirects to Live with no signposted way back to Setup | 🟢 UX | 🆕 TODO |
| 3 | Terms gate has no test/dev bypass | 🟡 tooling | 🆕 TODO |
| 4 | Cleanup: unused-imports sweep + remove now-unused deps | 🟢 cleanup | 🟡 PARTIAL — do after #1 |
| 5 | Playwright / service-worker "error" | — | ⏳ BLOCKED — needs the real error text |
| 6 | Carried over from `docs/app-review.md` (12 items, see below) | mixed | 🔍 partly re-verified |

Working order: **1 → 2 → 3 → 4 → (5 blocked) → 6.**

---

### 1. ESLint is broken project-wide — 🟡 TODO (needs OK to add dev-deps)

`npx eslint` fails: `couldn't find the config "next/core-web-vitals"`.
`.eslintrc.json` extends the Next.js preset but this is a **Vite** app. So
`npm run lint` has never gated anything — unused vars, missing hook deps, etc.
The missing `react-hooks/exhaustive-deps` warnings are the likeliest to hide real
bugs in the big components.

**Fix:** replace config with Vite/React — `@eslint/js`, `eslint-plugin-react-hooks`,
`eslint-plugin-react-refresh`, `typescript-eslint`. (Requires installing dev-deps.)

**Validation:** `npm run lint` runs; triage first run (fix real errors, silence
the rest deliberately); app builds + full suite passes; do NOT auto-fix repo-wide
in one commit.

---

### 2. Demo race redirects to Live with no way back — 🟢 TODO

`race/[id]/page.tsx` bounces the first open of the demo to `/race/:id/heat/1`,
one-shot per session, with no indication a Setup view exists. **Fix:** an
affordance on the Live screen for demo races — "watching a race in progress → go
to Setup".

**Validation:** a first-timer can get back to Setup without guessing; the one-shot
redirect still fires only once per session; a non-demo race is unaffected.

---

### 3. Terms gate has no test/dev bypass — 🟡 TODO

`TermsGate` blocks every control on first load in a fresh profile (broke all E2E
specs until worked around in `tests/helpers.ts` `acceptTerms()`). **Fix:** a
localStorage seed helper or env flag so automation/demos/screenshots skip the
legal dialog.

**Validation:** a real first-time user still sees + must accept; the bypass works
for tests without weakening the real path; a `TERMS_VERSION` bump still re-prompts.

---

### 4. Cleanup: unused-imports sweep + remove unused deps — 🟡 PARTIAL (after #1)

Already done in earlier passes: dead-file removal (ExportCSVButton, csvExporter),
category-bank dedup (`constants/categoryTemplates.ts`). Still deferred:
* ~64 unused imports/locals (`tsc --noUnusedLocals --noUnusedParameters`) — do
  after ESLint so "unused" is provable, and NOT in one repo-wide commit.
* Remove now-unused deps from `package.json`. `@mui/material` + `@emotion/*` are
  no longer imported (Loader is pure CSS now); also candidates: `@mui/lab`,
  `@mui/x-date-pickers`, `@react-google-maps/api`, `axios`, `dayjs`,
  `react-circular-progressbar`, `react-color`, `react-leaflet`. Verify each with
  a grep for imports first. (Bundle already excludes them — this is housekeeping.)
* `ViewModeToggle`, `AdminPanel` (Phase 2 roles) and `RaceCloudPanel` (Phase 4
  cloud) are unimported but PARKED planned-phase scaffolding — leave until decided.

---

### 5. Playwright / service-worker "error" — ⏳ BLOCKED

Only a snippet of `playwright.config.ts` was pasted, no actual error. To fix:
run `npx playwright test` (or `npm run test:e2e`) and paste the real error/stack
here. (Unblock ESLint separately via #1.)

---

### 6. Carried over from `docs/app-review.md` (that file has been retired)

`docs/app-review.md` (dated 2026-06-27) listed 14 numbered bugs. BUG-01
(`timeStartRace` format) and BUG-10 (Standing category filter no-op) were
confirmed fixed by direct code read and dropped from this list. The other 12
are carried here so their status isn't lost; three were spot-checked just now
and confirmed **still open** (marked below), the rest are genuinely unverified
— re-check the file/line before trusting either way.

| ID | Item | File | Status |
|----|------|------|--------|
| BUG-02 | IndexedDB VersionError silently wipes all race data | `stores/indexDb/indexedDbHelper.ts` ~L31-37 | ❓ unverified |
| BUG-03 | `calculatePositions` mutates Zustand store objects in place | `utils/calculatePosition.ts` L61 | ✅ **confirmed still open** — `rider.position_category = index + 1` still mutates directly |
| BUG-04 | Schedule "un-finish" leaves stale `timeArrive`/`elapsedTimeFromStart` on rider | `race/[id]/schedule/Schedule.tsx` | ❓ unverified |
| BUG-05 | DSQ/DNS toggles don't sync `raceStatus` | `race/[id]/schedule/Schedule.tsx` ~L706-728 | ✅ **confirmed still open** — DSQ toggle sets `status` only, no `raceStatus`; Un-DNS sets `raceStatus:"upcoming"` not `"running"` |
| BUG-06 | Duplicate `activeTab` across `appStore`/`uiStore` | `stores/appStore.ts`, `stores/uiStore.ts` | ❓ unverified |
| BUG-07 | CheckIn wave filter ignores `subCategory`, cross-matches by name only | `race/[id]/raceMode/CheckIn.tsx` | ❓ unverified |
| BUG-08 | Category ID collision risk (`Date.now() + index`) | `stores/categoryStore.ts`, `race/[id]/categories/Categories.tsx` | ❓ unverified |
| BUG-09 | Double IDB write per lap (`updateRider` + `updateAllRiders`) | `race/[id]/heat/[heatId]/page.tsx` | ❓ unverified |
| BUG-11 | `getNowWave` picks by absolute time diff, past wave can win over a closer future one | `race/[id]/riders/Riders.tsx` | ❓ unverified |
| BUG-12 | `RiderLiveModal` saves comment against stale rider prop | `race/[id]/heat/[heatId]/RiderLiveModal.tsx` | ❓ unverified |
| BUG-13 | No bib uniqueness check on rider add | `race/[id]/editRiders/EditRiders.tsx` | ✅ **confirmed still open** — no uniqueness check found anywhere in the file |
| BUG-14 | `getCategories` re-call after bank-add is a no-op (serves stale Zustand cache) | `race/[id]/categories/Categories.tsx` | ❓ unverified |

The code-quality (Q-01..06), UX (UX-01..10), and the three Roadmap sections
(Roles / Sockets / Database) from `docs/app-review.md` were folded into
`docs/roadmap.md` where not already present, or dropped where fully
duplicated — see that file for planned-phase work.
