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

### Important Constraints
- CSV import fields: `bib, first_name, middle_name, last_name, full_name, club, category, gender, heat, start_time, total_laps, position, points, federation, race_day`
- Club dictionary: manual JSON or in-app ClubDictionaryManager
- Hebrew + English support required (use `dir="auto"` on text elements)
- No database yet — all data is local IDB (planned: Phase 4)
