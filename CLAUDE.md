# Commissaire — App Overview for Agents

**Last Updated:** 2026-06-27  
**Tech Stack:** React + Vite + React Router v6, TypeScript, Zustand, IndexedDB (`idb`)

> Note: uses `[id]` folder names and `layout.tsx` but is NOT Next.js — routing is React Router v6.

---

## Quick Navigation

Read this file first, then drill into the specific doc as needed.

### Feature Docs
| Need | File |
|------|------|
| Bug list + code review | `docs/app-review.md` |
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
- **WARNING:** IDB VersionError handler currently deletes all data (see BUG-02 in `docs/app-review.md`)

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

### Known Issues (2026-06-27)
See `docs/app-review.md` for full bug list. Top 4 critical:
1. **BUG-01** — Results timing broken (`timeStartRace` stored as "HH:MM:SS", parsed as Invalid Date)
2. **BUG-02** — IDB VersionError handler deletes all race data
3. **BUG-03** — `calculatePositions` mutates Zustand store objects in place
4. **BUG-05** — DSQ/DNS toggles in Schedule don't update `raceStatus`

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
| Fix a bug | `docs/app-review.md` → find bug → listed file + line |
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

### Live tap / undo (heat page)
- Tapping a rider records a lap and, after a 1s flash, drops them to the end of
  `displayOrder` (the manual queue). The timer is held in `reorderTimersRef` per
  rider so an undo inside that window can cancel the move.
- Every action in the log carries `prevRider` (exact pre-tap snapshot) +
  `prevOrderIndex`. Undo restores from the snapshot — never rebuild state from
  `lapsDetails`, that drops `elapsedTimeFromStart` and `position_category`.
- Status buttons are ordered DNF → DSQ → DNS everywhere (`RiderLiveModal`,
  `StatusModal`); out-statuses come before the internal ones.

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

### Terms & Conditions (startup gate)
- Content lives in `legal/terms.ts` (the ONLY file to edit; it's a DRAFT, not
  lawyer-reviewed). `TermsGate` (rendered in `App.tsx`) blocks the app until the
  user accepts; acceptance is persisted + versioned in `legal/termsAcceptance.ts`.
  Bump `TERMS_VERSION` to re-prompt everyone. The `/terms` route shows the full text.

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
