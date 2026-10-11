# Commissaire — App Overview for Agents

**Last Updated:** 2026-07-25  
**Tech Stack:** React + Vite + React Router v6, TypeScript, Zustand, IndexedDB (`idb`)

> Note: uses `[id]` folder names and `layout.tsx` but is NOT Next.js — routing is React Router v6.

---

## Quick Navigation

Read this file first, then drill into the specific doc as needed.

### Feature Docs
| Need | File |
|------|------|
| Open bugs | `BUGS.md` |
| Feature roadmap (phases 1–5) | `docs/roadmap.md` |
| CSV import component flow | `docs/csv-import.md` |
| Photo/OCR start-list import (offline tesseract.js) | `docs/local-ocr.md` |
| Club dictionary system | `docs/club-dictionary.md` |
| Rider data structure + store | `docs/rider-data.md` |
| Race data structure + store | `docs/race-data.md` |
| Category data structure + store | `docs/category-data.md` |
| GitHub Pages deployment (CI, custom domain, SPA routing) | `docs/github-pages.md` |
| Cloud sync, per-race roles, Supabase (numbered doc set) | `docs/cloud/0-START.md` |
| All CSV field types | `src/app/types/csv.types.ts` — `RiderFieldKey` type |
| All core types | `src/app/types/types.ts` |
| Zustand stores | `src/app/stores/` directory |

### Key Files & Directories
```
src/
├── app/
│   ├── components/csv/           # CSV import wizard (4 steps)
│   ├── components/importImage/   # Offline photo-OCR import (tesseract.js)
│   ├── stores/                   # Zustand state + IDB persistence
│   │   ├── ridersStore.ts
│   │   ├── categoryStore.ts
│   │   ├── racesStore.ts
│   │   ├── appStore.ts           # auth + activeTab
│   │   ├── uiStore.ts            # modals + isRaceMode
│   │   └── indexDb/indexedDbHelper.ts
│   ├── types/
│   │   ├── types.ts              # RaceProps, CategoryProps, RiderProps
│   │   └── csv.types.ts          # CSV import types
│   ├── services/                 # csvMapper, templateStorage
│   ├── utils/
│   │   ├── timeUtils.ts          # formatTime, parseTimeStr, startTimer
│   │   └── calculatePosition.ts  # position ranking (NOTE: mutates — see BUG-03)
│   └── race/[id]/
│       ├── raceMode/             # StartManager, CheckIn, LiveBoard
│       ├── heat/[heatId]/        # Live lap recording screen
│       ├── categories/           # Category management + RacingRider/FinishRider
│       ├── riders/               # Rider list + import
│       ├── schedule/             # Schedule builder + buildSchedule()
│       ├── results/              # Results tab
│       └── standing/[heatId]/    # Standing/leaderboard page

public/data/
├── dictionary_csv.json           # Field keywords (bib, first_name, club, etc.)
├── dictionary_clubs.json         # Club name mappings
└── README.md
```

---

## Architecture Notes

### Persistence
- **IndexedDB** (`commissireDb` v8) is the source of truth — stores: `riders`, `categories`, `races`, `roles`, `users`
- **Zustand** is the in-memory cache — each store has a custom IDB adapter
- Load pattern: Zustand cache hit → short-circuit (never touches IDB again)
- **WARNING:** IDB VersionError handler currently deletes all data (see BUG-02 in `BUGS.md`)

### State Stores
| Store | Purpose | Persisted |
|---|---|---|
| `useRaceStore` | Races list | Yes (IDB) |
| `useCategoryStore` | Categories per race | Yes (IDB) |
| `useRiderStore` | Riders per race | Yes (IDB) |
| `useDataStore` | Auth + `activeTab` | No |
| `useUIStore` | Modals + `isRaceMode` | No |

### Race Mode Flow
1. `race/[id]/page.tsx` — tab container, switches to `<RaceMode>` when `isRaceMode` is true
2. `RaceMode.tsx` — wave selector → sub-tabs: Start / CheckIn / Board
3. `StartManager.tsx` — validates groups, starts heat, sets `timeStartRace` on all riders
4. `heat/[heatId]/page.tsx` — live lap recording: `handleRiderClick` is core action
5. `calculatePositions()` — run after every lap to rank riders

---

## Current Work Status

### Completed Features
- CSV import wizard (4-step: upload → mapping → preview → import)
- Club dictionary system (multi-term, Hebrew + English)
- Middle name field in rider model
- Column mapping templates (save/load)
- RaceMode with StartManager, CheckIn, LiveBoard
- Live heat page with lap recording, DNF/DSQ/DNS, revert lap
- Double-tap → RiderLiveModal (comment, status, history)
- Schedule builder with wave grouping
- Standing/leaderboard page per wave
- Results tab

### Known Issues
See `BUGS.md` for current open items (BUG-01 and BUG-10 from the old bug list are
confirmed fixed and no longer tracked; BUG-03, BUG-05, and BUG-13 are confirmed
still open).

### Next Phases (see `docs/roadmap.md`)
1. **Phase 1** — Bug fixes (see checklist in roadmap.md)
2. **Phase 2** — Roles system (Owner / Commissaire / Viewer)
3. **Phase 3** — WebSocket multi-user (parallel lap recording)
4. **Phase 4** — Database (Postgres / Supabase)
5. **Phase 5** — Polish, export, PWA

---

## Agent Task Guidelines

### Token Efficiency Rules
1. Read `CLAUDE.md` first (this file)
2. Then read only the specific doc for the task
3. Use Grep / Explore agent for codebase searches — don't read entire large files
4. Read files with `offset` + `limit` if you only need a section

### Common Tasks
| Task | Where to start |
|---|---|
| Fix a bug | `BUGS.md` → find item → listed file + line |
| Add new rider field | `types.ts` → `rowToRider` in CSVImportWizard → display components |
| Fix CSV import bug | `docs/csv-import.md` → csvMapper.ts |
| Add dictionary entry | `public/data/*.json` |
| Update UI component | Component file + matching `.module.css` |
| Add role/permission | `docs/roadmap.md` Phase 2 checklist |

### Category colours
- Assigned by `utils/colorAssignment.ts`, not by palette index. Colours are chosen
  in CIE L*a*b* space so categories that can be **on course together** look clearly
  different; `CLOSE_START_MINUTES` is 90 because a race runs up to 1.5 h while waves
  go off ~10 min apart. Colours recycle outside that window on purpose.
- Assign only after every category and start time is known — never while iterating.
- `race.autoColor === false` means the organizer picks colours by hand; `undefined`
  counts as true so existing races keep auto-colouring.

### Static assets must go through BASE_URL
- Prod is served from `/commissire-race/`, so `import.meta.env.BASE_URL` is required
  on every `public/` asset reference. A hardcoded `/foo.svg` works in dev and 404s
  in production — this is what silently broke all rider flags.
- Rider flags: use `<RiderFlag>` (`race/components/riderFlag/RiderFlag.tsx`). It
  renders nothing when the flag is missing or the file 404s. Only gb/il/it/us ship.
- `public/example.csv` is the downloadable start-list template offered in the import
  wizard. It has a UTF-8 BOM (Excel needs it for Hebrew) — preserve it if editing.

### `public/` is published verbatim — runtime assets only
- Everything in `public/` is copied into `dist/` and served publicly on
  commissaire.us. **Never put documentation or an `AGENT.md` there** — that is how
  `public/AGENT.md` and `public/data/DICTIONARY_GUIDE.md` became world-readable;
  they now live at `docs/public-assets.md` / `docs/dictionary-guide.md`.
- `npm run build` ends with `scripts/verify-dist.mjs --prune`, which strips
  markdown/agent/test/source-map/config files out of `dist/`; the deploy workflow
  re-runs it read-only (`npm run verify:dist`) and FAILS the deploy if any remain.
  Deploy-critical files (`index.html`, `404.html`, `CNAME`, `manifest.json`,
  `sw.js`, `favicon.ico`) are in the script's `ALWAYS_KEEP` exemption list — add to
  it before introducing another root-level special file.
- Source maps stay off (`build.sourcemap: false` in `vite.config.ts`). See
  `docs/github-pages.md`.

### Live tap / undo (heat page)
- Tapping a rider records a lap and eventually drops them to the end of
  `displayOrder` (the manual queue) — but only after the **board hold** expires;
  see below. Undo before then cancels the move.
- Every action in the log carries `prevRider` (exact pre-tap snapshot) +
  `prevOrderIndex`. Undo restores from the snapshot — never rebuild state from
  `lapsDetails`, that drops `elapsedTimeFromStart` and `position_category`.
- Status buttons are ordered DNF → DSQ → DNS everywhere (`RiderLiveModal`,
  `StatusModal`); out-statuses come before the internal ones.
- The action log (`riderActions`) is the complete arrival record and is PERSISTED
  per wave to localStorage (`commissaire.actionLog.${raceUuid}:heat:${heatId}`) so
  a mid-wave reload restores it. `useLapRecording` takes `persistKey`; it hydrates
  synchronously and guards against writing the previous wave's log under a new key.

### Board hold (heat page) — why tapped cards don't move immediately
- Problem: at the end of a lap a bunch of ~20 riders crosses together. One
  commissaire shouts bibs, another types them. Dropping each card to the end of
  the queue on its own timer reshuffled the board about once a second, so the
  typist lost track of where the next card was.
- The fix is a **board-wide trailing debounce**, NOT a per-card delay — that
  distinction is the whole point. A per-card delay changes nothing: with taps
  arriving once a second, cards still move once a second, just later. Instead
  every tap restarts ONE shared timer (`holdTimerRef` in `useLapRecording`), so
  the board is completely frozen for the length of the burst; when the arrivals
  stop, every pending card drops to the bottom in a single `setDisplayOrder`,
  in tap order. Do not "simplify" this back to per-rider timers.
- Only the card's POSITION is deferred. Lap count, lap time, `timeArrive`, the
  since-arrive clock and the action-log entry all land at tap time, unchanged.
- `pendingMoveRef` (`Map<riderId, didFinish>`, insertion-ordered) holds the
  queue; it's mirrored to `pendingMoveIds` state so cards can render the
  "recorded, waiting" state (`data-recorded="true"`, washed-out overlay + green
  ✓ in `RacingRider`). That marker is REQUIRED, not decoration: the drop to the
  bottom used to be the only confirmation a tap registered, and the flash lasts
  ~1s and only ever plays on the most recently tapped card.
- `maxBoardHoldMs()` (3× the hold, min 10s) force-flushes from the FIRST pending
  card so a steady trickle can't restart the debounce forever and freeze the
  board for the whole race.
- Both undo paths (`restoreFromSnapshot`, `cancelAction`) call `dropPendingMove`,
  and a wave change clears the queue without applying it.
- Delay is user-selectable (1/2/3/5/10s, default 2) in `stores/boardHoldStore.ts`
  — a zustand store, not a hook like `useJokerMode`, because it's edited from the
  main side menu AND the live screen's settings gear (`VoiceSettingsModal`, now
  titled "Live Settings") and the heat page must pick up the change without a
  remount.

### Joker button (heat page) — unidentified-rider taps
- Opt-in via a side-menu checkbox (`useJokerMode`, localStorage
  `commissaire.jokerEnabled`, default off — `HeaderMain.tsx`). Off means the
  button/strip never render; nothing about the normal tap path changes.
- Solves "bunch arrives at once, can't read bibs fast enough": tapping the bike
  icon (left of the bib search, `page.tsx`) stamps a `JokerEntry` — just a
  timestamp + sequence number, held in `useJokerQueue` — with **no rider
  lookup at tap time**. Unlimited taps, each gets its own card in the
  "🃏 Unresolved" strip with a live ticking "time since tapped" clock.
- Persisted per wave to localStorage (`commissaire.jokers.${raceUuid}:heat:${heatId}`,
  sibling key to `commissaire.actionLog.*`, same hydrate/guard pattern) — a Joker
  survives a mid-wave reload same as the action log does.
- Resolving (tap a Joker card → type a bib → Save) calls the *same*
  `recordLap(rider, "click", atTime)` used by a normal tap, just backdated to
  the Joker's `capturedAt` instead of "now" — so the lap lands with the exact
  original time/position and, critically, rides the existing `riderActions` log
  for free: Revert Last Lap and action-log undo work on a resolved Joker with
  zero new undo code. Blocked (toast, stays unresolved) if the target rider
  already has a `timeArrive` newer than the Joker's `capturedAt` — refuses to
  rewrite history backwards.
- `recordLap`'s duplicate-tap debounce (`lastActionRef`) is keyed off real
  `Date.now()`, not the (possibly backdated) `atTime` — backdating a Joker
  resolution must never produce a negative, always-truthy diff there.

### View-only (downloaded) races
- `RaceProps.viewOnly` marks a race pulled in via "Download a Race" — a read-only
  copy for viewing results. Set in `DownloadRace.tsx`. Such races get a LIGHT
  delete: a one-tap trash on the race-list `RaceCard` (tap → "Remove?" → tap again,
  no modal, wired via `main/page.tsx` `handleDeleteRace`) and a plain "Remove
  downloaded race" in the Info tab instead of the heavy Danger-Zone confirm.

### Bundle / code-splitting (BUGS.md #1)
- Initial JS is ~65 kB gz (was 559 kB). Keep it that way:
  - Routes are `React.lazy` in `App.tsx` (landing `/` stays eager) under one
    `<Suspense fallback={<Loader/>}>`.
  - Heavy libs load on demand, never eagerly: **xlsx** via dynamic `import("xlsx")`
    inside handlers (`Info.tsx`, `CSVImportWizard`, `saveRace`) + the util files
    (`raceExport`/`raceImport`/`xlsxParser`) are only reached through those;
    **leaflet** via `lazy(() => import("./map/Map"))`; **tesseract** via
    `lazy(ImageCapture)`; **supabase** — App.tsx checks `isCloudConfigured()` from
    `services/cloud/cloudConfig.ts` (env only, no SDK) and dynamically imports the
    cloud store only when configured.
  - `Loader` is pure CSS — do NOT reintroduce `@mui/material`/`@emotion`.

### App version
- Single source of truth: `src/app/version.json` (`{ version, date }`), imported
  by `components/Version/Version.tsx` and shown in the side-menu footer. Edit it
  before each release. `VITE_APP_VERSION` still overrides if set at build time.

### Start-list template download
- `public/start-list-template.xlsx` (synthetic sample rows, NOT real riders) is
  offered from the side menu (`HeaderMain`) via a BASE_URL `<a download>`. Users
  fill it in and import. Matches the Hebrew column layout the auto-mapper expects.

### Start-list import paths (xlsx vs csv)
- Create Race (`saveRace` → `insertRidersCsv`) handles BOTH: `.xlsx` goes through
  `parseXLSXFile`, `.csv` through `file.text()`+Papa, then the shared
  `saveRidersFromRows`. Do NOT `file.text()` an xlsx — it's binary and mangles.
- The Edit-Riders quick importer is CSV/TXT only (its own `parseCSV`, `accept=
  ".csv,.txt"`). The 4-step wizard (`CSVImportWizard`) handles xlsx via
  `parseXLSXFile`. All three share `rowToRider` / `autoMapColumns` (BUGS.md #20).

### Import: "Keep as info" columns
- The mapping step offers a synthetic target `infoField` ("Keep as info") for any
  UNrecognised column. It's MULTI-USE (many columns can be info) and never
  auto-detected. `rowToRider` stores each such column's raw value in
  `rider.extraFields[<original header>]`, shown in the rider card's "More info".
  A recognised extra-field label always wins over an info column of the same key.

### Live timer + Clear board (heat page)
- The clock derives from the earliest started rider's `timeStartRace`. When the
  wave is stopped (every started category `finished`) it FREEZES at the latest
  category `finishedAt` — do not derive it from a "running" rider, that resets to
  0 on stop.
- `clearedWave` state (reset on heatId change) wipes the board to 00:00:00 and
  empties the rider lists. The "Clear board" button shows only when `waveStopped`,
  behind a confirm. It's view-only — results stay in the Results tab.

### Results column picker
- The Results toolbar has a "Columns" menu; Bib/Laps/Time/Status toggle, Place and
  Name always show. Choice persists in localStorage (`resultsVisibleFields`). Rows
  are flexbox so hiding a column reflows and gives the name room.

### Terms & Conditions (landing-page acceptance)
- Content lives in `legal/terms.ts` (the ONLY file to edit; it's a DRAFT, not
  lawyer-reviewed). Acceptance is persisted + versioned in
  `legal/termsAcceptance.ts` (`hasAcceptedCurrentTerms` / `acceptCurrentTerms`,
  localStorage key `termsAcceptance`). Bump `TERMS_VERSION` to re-prompt everyone.
  The `/terms` route shows the full text.
- The app is free with no login, so terms are accepted on the LANDING page
  (`app/page.tsx`) — an "I have read and agree" checkbox (with a `/terms` link)
  GATES the "Press Start" / "Enter the App" CTAs: both are `disabled` and
  `handleEnter` refuses until `termsAccepted`. The checkbox hides once accepted
  (asked once). There is no longer a full-screen startup gate.
- Tests seed the localStorage acceptance record directly (`acceptTerms` in
  `tests/helpers.ts`, using `TERMS_VERSION`); they also navigate straight to
  `/main`, which bypasses the landing CTA anyway.

### Laps: the category is the source of truth
- `rider.totalLaps` is only a cache of `category.laps`. Riders imported without a
  laps column start at 0.
- **Reading:** resolve via `effectiveTotalLaps()` / `withCategoryLaps()` from
  `race/[id]/schedule/Schedule.tsx`. Never render or compare `rider.totalLaps` raw —
  `LiveCards` gates finishing on it, so a 0 means the rider never finishes.
- **Writing:** every change to `category.laps` must go through
  `updateCategoryAndSyncRiders()` in `Categories.tsx`, never `updateCategory()` directly.
- Resolution is `category.laps || rider.totalLaps` on purpose: a category at 0/null
  means "not set yet" and must not wipe laps that came from the start list.

### Categories are flat (no sub-categories)
- One category per age band — `"Man Masters 30-39"`, not `"Man Masters"` + `"30-39"`.
  `"Man Pro"`/Elite stay a single category.
- `subCategory` still exists on `RiderProps`/`CategoryProps` and in the category
  identity key (`name::subCategory`) **only** so pre-existing races keep rendering.
  Nothing authors it anymore — new categories always get `null`.
- Import: `subCategory` is in `IGNORED_FIELDS` (`types/csv.types.ts`). Its keywords
  are kept on purpose so a `תת קטגוריה` / `Age Group` column is absorbed by that
  field rather than fuzzy-matching `קטגוריה` and overwriting the real category.

### Bib vs Standing (distinct fields — do not conflate)
- `bibNumber` — the number on the rider's plate. Identity only.
- `standing` — pre-race ranking/seeding order (from previous points). Row order in
  the start list, so new unranked riders get a bib unrelated to their row.
- Column auto-mapping assigns each field to its **best-matching column anywhere in
  the row**, not the first one. Vague headers (`מס'`, `No.`, `#`) are capped at
  confidence 75 (`AMBIGUOUS_ALIAS_CAP`) so a specific header (`מספר רוכב`, `bib`)
  always wins; a vague header that loses is left unmapped rather than falling
  through to an unrelated field. Serial/seed headers map to `standing`.
  See `AMBIGUOUS_ALIASES` / `SEED_ORDER_ALIASES` in `types/csv.types.ts`.

### Important Constraints
- CSV import fields: `bib, first_name, middle_name, last_name, full_name, club, category, gender, heat, start_time, total_laps, position, points, federation, race_day`
- Club dictionary: manual JSON or in-app ClubDictionaryManager
- Hebrew + English support required (use `dir="auto"` on text elements)
- No database yet — all data is local IDB (planned: Phase 4)
