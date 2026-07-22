
importent at this page all bugs and fitures you have to write some smal comment at the agents /read me so we know all the fitures of the app
after finish fix bug or fiture re organize the md files AGENT BUGS

> Completed items were removed to keep this file to OPEN work only. Their
> write-ups live in git history and the feature notes are in CLAUDE.md. Below is
> only what's left to do, renumbered 1..N in working order.

---
## OPEN ITEMS  (updated 2026-07-22)

| #  | Item | Priority | Status |
|----|------|----------|--------|
| 1 | JS bundle 1.76 MB (558 kB gz) — slow first load on a phone | 🔴 bottleneck | 🆕 TODO |
| 2 | ESLint broken project-wide (extends a Next.js preset in a Vite app) | 🟡 tooling | 🆕 TODO — needs OK to add dev-deps |
| 3 | Demo race redirects to Live with no signposted way back to Setup | 🟢 UX | 🆕 TODO |
| 4 | Terms gate has no test/dev bypass | 🟡 tooling | 🆕 TODO |
| 5 | Cleanup: dead-file sweep + single-source-of-truth | 🟢 cleanup | 🟡 PARTIAL — do after #2 |
| 6 | Playwright / service-worker "error" | — | ⏳ BLOCKED — needs the real error text |

Working order (user rule: bottleneck + important first, then the rest, 1 by 1):
**1 → 2 → 3 → 4 → 5 → (6 blocked).**

Recently landed (this session):
* **✅ Live log persisted per wave.** The rider action log (every arrival, newest
  first) is now mirrored to localStorage keyed `${raceUuid}:heat:${heatId}`, so a
  mid-wave reload restores the whole log. Hydrates synchronously; a guard stops the
  old wave's log being written under a new wave's key. Files:
  `race/[id]/heat/[heatId]/useLapRecording.ts` (+ `persistKey` from `page.tsx`).
* **✅ View-only (downloaded) races: light delete.** `RaceProps.viewOnly` is set on
  download; such races get a one-tap trash on the race list card (tap→confirm, no
  modal) and a light "Remove downloaded race" in the Info tab instead of the heavy
  Danger-Zone confirm. Files: `DownloadRace.tsx`, `main/page.tsx`, `RaceCard.tsx`,
  `race/[id]/info/Info.tsx`, `types.ts`.
* **✅ Import: "Keep as info" for any column.** New synthetic mapping target
  `infoField` (multi-use, never auto-detected) keeps an UNrecognised column's raw
  value in `rider.extraFields[<column header>]`, shown in the card's "More info".
  Files: `types/csv.types.ts`, `components/csv/ColumnMappingStep.tsx`,
  `PreviewStep.tsx`, `ImportProgressStep.tsx`, `services/riderRowMapper.ts`.

---

### 1. JS bundle is 1.76 MB — slow first load on a phone — 🔴 TODO (doing first)

`npm run build` warns:
```
dist/assets/index-*.js   ~1,758 kB │ gzip: ~558 kB
```
Irrelevant on a laptop, but the users are at a start line on phone data. ~558 kB
gzipped before first paint is slow exactly when it matters, and a PWA cold start
after an update pays it again.

Likely heavy passengers, all rarely touched:
* `tesseract.js` — photo/OCR import
* `xlsx` — export/import
* `leaflet` + `react-leaflet` — the map tab
* `@mui/material`, `@mui/x-date-pickers`
* `@supabase/supabase-js` — cloud sync

**Fix:** `React.lazy` + dynamic `import()` for the OCR wizard, map tab, and Excel
export/import so none are in the initial chunk; then `manualChunks` for the rest.
MEASURE before/after — don't guess which import is expensive.

**Validation:** record baseline initial-chunk size; verify it drops materially
(target < 500 kB raw); verify OCR, map, and Excel still work on demand; full test
suite green.

agent wrote me , but im not sure its ok to remove need to check Node modules and libraries: likely unused dependencies
These appear not referenced in source and are good candidates to remove from package.json:

@emotion/react
@emotion/styled
@mui/lab
@mui/x-date-pickers
@react-google-maps/api
axios
dayjs
react-circular-progressbar
react-color
react-leaflet
Note: @mui/material is used (loader), so keep it unless you replace that component.

---

### 2. ESLint is broken project-wide — 🟡 TODO (needs OK to add dev-deps)

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

### 3. Demo race redirects to Live with no way back — 🟢 TODO

`race/[id]/page.tsx` bounces the first open of the demo to `/race/:id/heat/1`,
one-shot per session, with no indication a Setup view exists. **Fix:** an
affordance on the Live screen for demo races — "watching a race in progress → go
to Setup".

**Validation:** a first-timer can get back to Setup without guessing; the one-shot
redirect still fires only once per session; a non-demo race is unaffected.

---

### 4. Terms gate has no test/dev bypass — 🟡 TODO

`TermsGate` blocks every control on first load in a fresh profile (broke all E2E
specs until worked around in `tests/helpers.ts` `acceptTerms()`). **Fix:** a
localStorage seed helper or env flag so automation/demos/screenshots skip the
legal dialog.

**Validation:** a real first-time user still sees + must accept; the bypass works
for tests without weakening the real path; a `TERMS_VERSION` bump still re-prompts.

---

### 5. Cleanup: dead files + single source of truth — 🟡 PARTIAL (after #2)

Two important bugs from this pass already fixed (BUG-02 IDB wipe, BUG-03
calculatePositions mutation). Still deferred:
* Dead-file sweep — reachability candidates (ExportCSVButton, ViewModeToggle,
  RaceCloudPanel [cloud tab hidden], AdminPanel, etc.) + ~64 unused imports/locals
  (`tsc --noUnusedLocals --noUnusedParameters`). Verify each removal against a
  build so nothing lazily-referenced breaks.
* `PREDEFINED_TEMPLATES` duplicated in `Categories.tsx` + `CategoryManager.tsx`.
* Do AFTER #2 (ESLint) so "unused" is provable.

---

### 6. Playwright / service-worker "error" — ⏳ BLOCKED

Only a snippet of `playwright.config.ts` was pasted, no actual error. To fix:
run `npx playwright test` (or `npm run test:e2e`) and paste the real error/stack
here. (Unblock ESLint separately via #2.)
