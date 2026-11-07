# Commissaire — App Overview for Agents

**Last Updated:** 2026-11-07 — start with `AGENTS.md` (rules, deployment) and `docs/CURRENT_STATE.md` (current state, resume steps)  
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
| Server tests (unit always; database tests only on a dedicated `*_test` cloud DB) | `docs/server/testing.md` |
| Production deployment (one Linux server: app in `/var/www/commissaire`, API = PM2 `server-commissaire` :5000, same domain; manual releases) | `docs/server/deployment.md` |
| Old GitHub Pages setup (no longer used for production) | `docs/github-pages.md` |
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
| `useUIStore` | Modals + `raceModeRace` (the race in Race mode; per race, so a new race never opens on another race's mode) | No |

### Race Mode Flow
1. `race/[id]/page.tsx` — tab container, switches to `<RaceMode>` when `raceModeRace` is this race
2. `RaceMode.tsx` — wave selector → sub-tabs: Start / CheckIn / Board
3. `StartManager.tsx` — validates groups, starts heat, sets `timeStartRace` on all riders
4. `heat/[heatId]/page.tsx` — live lap recording: `handleRiderClick` is core action
5. `calculatePositions()` — run after every lap to rank riders

---

## Current Work Status

### Completed Features
- CSV import wizard (4-step: upload → mapping → preview → import)
- Club dictionary: UI removed 2026-11-04 (seed file never existed, only the wizard applied it); store + rowToRider hook kept for existing entries
- Middle name field in rider model
- Column mapping templates (save/load)
- RaceMode with StartManager, CheckIn, LiveBoard
- Live heat page with lap recording, DNF/DSQ/DNS, revert lap
- Double-tap → RiderLiveModal (comment, status, history)
- Schedule builder with wave grouping
- Standing/leaderboard page per wave
- Results tab
- Finish Race — signed, irreversible close-out (see section below)

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
- Status buttons are ordered DNF → DSQ → DNS (`RiderLiveModal`, `StatusModal`);
  out-statuses come before the internal ones. Check-In offers DSQ (left) | DNS (right)
  and "Standing" only as a way back (`StatusModal` never offers Standing to a standing
  rider). Bibs are edited with the pencil next to the number, phones included.
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

### Live screen readability, filter, Recap (2026-11-04)
- Rider cards pick their ink from the category colour (`data-ink` dark/light in
  `RacingRider`, WCAG crossover 0.179, not 0.5). Contrast is typography only —
  ink colour, weight, a fine engraved/drop shadow; NO plates, pills or boxes behind
  the counters (tried, rejected: it broke the card design). PRO keeps its pink
  lettering on deep colours and uses deep ink + a lighter bottom gloss on light ones.
- Category filter options = the wave's categories that have riders of this race
  (`heat/[heatId]/liveFilter.ts`), with counts; stale choices drop on wave change.
- Recap mode is toggled from the Wave info sheet (tap the wave chip), not the
  filter panel. Finish Wave is an outlined button; the typed FINISH confirm stays.

### Finish Wave / starting a wave while another runs
- Live's Finish Wave confirm is `heat/[heatId]/FinishWaveModal.tsx` ("Finish This Wave?",
  summary, typed FINISH, Confirm Finish, short celebration). `finishWaveFromLive`
  returns true when it finished; the modal closes itself via a ref'd onClose (Live
  re-renders every second — a plain onClose dep restarts the timer forever).
- One wave at a time is still enforced by StartManager + the engine. The UI never
  blocks silently: `utils/activeWave.runningWaveOtherThan` names the running wave;
  the Race card's Start (and a card tap that would open Start) shows
  `WaveBlockedNotice` (Back to Race / Go to Active Wave); on the Start screen the
  Start buttons stay tappable and open the same notice, plus a banner (both layouts).

### Card cover (heat page)
- How long a tapped card stays washed out: 10 s / 30 s / 2 min / 4 min, default 10 s
  (`coverMs` in `boardHoldStore`, set in Race Setup). Separate from the board hold:
  the hold decides when the card moves, the cover how long it looks "just passed".
- Derived in `RacingRider` from `rider.timeArrive`, never stored, so reload and undo
  just work. `data-recorded` still means only "waiting for the hold"; the cover is
  `data-covered`, and the green ✓ stays with the hold.

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

### Finish Race (finalizing) — the one irreversible action
- The footer button on the **Info** tab. It computes the final classification,
  closes every category, and stamps `RaceProps.finalized` (a `RaceFinalization`:
  SHA-256 token over who/when/nonce + a digest of every rider's result). There is
  deliberately **no unfinish** — that's the whole guarantee. `utils/finalizeRace.ts`
  is the only thing that writes it.
- **Order is load-bearing**: riders → categories → race. The race is stamped LAST,
  because stamping it is what turns the lock on and the store guards would then
  reject the finalize flow's own writes.
- Riders still on the road become **finishers on the laps they completed**, never
  DNF — same rule as `closeOutRiderOnTrack` in StartManager. DNF is a human
  classification; never infer it from the clock. DNF/DSQ/DNS are preserved.
  Riders of a wave/category that never started become **DNS**, and that category is
  closed "not started". ONE rule, `shared/race/finalPlan.ts` `planFinalization`, used
  by the confirmation modal (shows the exact lists first), the local finalize and the
  server finalize transaction; Finish Wave (`waveFinish.planWaveFinish` + engine
  `WaveFinished`) applies the same rule to its wave.
- **The lock is enforced in the STORES, not the UI** (`utils/raceLock.ts`).
  `ridersStore` (add/insert/update/patch/updateAll/delete/deleteByRace),
  `categoryStore` (upsert/update/rebuild/recolour) and `racesStore.updateRace`
  all no-op for a finalized race. Hiding buttons is the courtesy half; the guard
  is what makes "nothing can change" true for screens nobody remembered to gate.
  Never write to IndexedDB directly to get around it.
  - `racesStore.updateRace` allows an explicit field allowlist
    (`FINALIZED_WRITABLE_FIELDS`: isFavorite, viewOnly, syncedAt, serverVersion,
    lastUpdateAt, finalized) — local bookkeeping that says nothing about results.
  - `createCategoriesFromRiders` is intentionally NOT guarded: it only fires when
    a race has zero categories, and blocking it would leave a finalized race with
    nothing to group results by.
  - Deleting the whole race still works because `page.tsx` calls `deleteRace`
    BEFORE `deleteRidersByRace` — removing the race lifts the lock for the
    cache-cleanup step. Don't swap that order back.
- UI consequences: `RacePhaseSwitcher` collapses to a "Final results" seal (no
  Start/Live), the heat route redirects to the race, `FINALIZED_TABS` drops
  Schedule/Categories and leads with Results, Riders loses its Actions menu and
  Delete All, `RiderDetailModal` loses Edit (it reads the lock itself, so all
  three callers are covered), and Info swaps Edit/Import for the certificate.
- **Import adopts the lock**: `raceImport` reads `finalized` off the Race sheet
  and self-verifies it; a "replace" import applies it, so a final result handed to
  another commissaire arrives read-only on their device. Merge mode does not — a
  partial merge is still someone's own in-progress race. An unverifiable record is
  dropped, so a hand-typed row can't lock someone else's race.
- Signing primitives live in `utils/raceSignature.ts`, which is **xlsx-free on
  purpose** — `raceExport`/`raceImport` are dynamic-import-only (BUGS.md #1) and
  finalizing runs from eager code. raceExport imports from raceSignature, never
  the reverse.

### First finish – all finish (category bell / finish)
- `utils/linkedGroups.ts` `computeGroupSignals`: when a category's leader has 1
  lap left every rider in it shows the bell and the card's counter reads "Last";
  once the leader has finished all laps everyone finishes on their next crossing
  ("Finish"), whatever their lap count. Derived, never stored — undo restores all.
- Per race, `race.leaderFinishAll` (undefined = ON). Toggle on the Categories tab
  and in the live screen's Live Settings gear. Off = every rider rides full laps.

### Race timeline (Race page)
- `WaveTimeline` runs from 1 h before the first start to 2 h after the last. Each
  card lists its starts and their categories, so its height comes from the row
  counts (`cardHeight`, fixed `--row-*` heights in the CSS: change both together).
- `raceMode/timelineAxis.ts` stretches the time axis where a card needs the room,
  so waves never overlap. Place anything time-based with `axis.toY`, not a fixed
  px-per-minute.
- Card tint comes from `raceMode/waveHealth.ts`: light red when a wave hasn't
  started or finished in time, has a bib problem, or its Check-In isn't done;
  otherwise light green. DNF/DNS riders alone don't turn a wave red. Time checks
  use the race date, so a future race isn't judged by today's clock.
- Running wave card actions: Live is the big solid-green primary button and Finish a small red
  outline; once everyone is in (started, nobody on course, no start group waiting) "Finish Wave"
  becomes the big solid-red button and Live goes small. Primary buttons are 30 px tall to fit the
  fixed `--row-actions` row (34 px) — keep them within it or update `cardHeight`.
- Diagonal stripes only on the Check-In button (red until done, then green) and on
  a finished wave's card (green).

### Check-In changes report
- Status changes and bib edits at Check-In, and riders added by hand, go through
  `logCheckInChange` (`stores/checkInChangesStore.ts`) into the race's audit log.
- Late entries: each Check-In category has the same add-rider icon and form as
  CREATE > Riders (`QuickAddRider`), until the wave starts. Who may add is ONE rule,
  `canAddRider` (`ADD_RIDER` + the role's `riders.create`), used by both screens;
  the save goes through `addNewRider`, which sends a shared race's rider to the
  server first and refuses what the role doesn't allow.
- The wave card shows a warning triangle with the count when there are changes
  (needs `EDIT_RACE`); it opens `raceMode/CheckInChanges`. The log is per device
  (OPFS), so changes made on another phone don't appear here.

### Bib warning before Start
- `utils/bibIssues.ts` is the ONE bib check (missing bib / race-wide duplicate,
  DNS ignored). StartManager blocks on it; `race/components/bibWarning/BibWarning`
  shows the same issues for UPCOMING categories at the top of Race and Live, so
  the organizer sees them on arrival. Tapping a row selects that wave and opens
  Check-In (on Race) or the Race screen (from Live).

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

### Import: fields we try not to collect
- `OPT_IN_FIELDS` (`types/csv.types.ts`: birth date, UCI ID, bib colours) are never
  auto-mapped, not even from a learned mapping, so Create Race never imports them
  and the wizard lists them under Not imported until the user picks the field.
- National ID / passport columns are stricter: `isIdColumnHeader` blocks them
  entirely (PRD FR-45), no manual mapping either.

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
- The Results toolbar has a "Columns" menu; Bib/Laps/Time/Gap/Speed/Status toggle,
  Place and Name always show. Choice persists in localStorage (`resultsVisibleFields`).
- Each row is a card: position, bib and full name (wraps, never cut), then every
  chosen field, labelled. Layout is decided per category block by a container
  query (`results-cat`): narrow → fields under the name, wrapping; ≥600px → one
  line, fields in aligned min-width columns. Never hide a chosen field.
- Sort (Place default, Time, Name, Bib), Wave and Category live in ONE closed-by-
  default menu (filter icon, `results-filter-btn`); no chip bar, no permanent pills.

### Board & Results: live refresh (client only)
- Both read the local stores; a shared race's changes arrive over the app's ONE
  Socket.IO connection (`race:changes`). `useLiveRaceRoom` (`services/live/
  liveRaceRoom.ts`) joins the race's room on direct loads too.
- `catchUp` is deduplicated per race (one in flight + one follow-up). The HTTP
  fallback runs only while the socket is down, the tab is visible and the race can
  still change (not finalized / not all categories finished). Returning to a tab
  catches up only if the socket missed something.
- Refresh button (`board-refresh`, `results-refresh`): shared race → catch-up since
  the last applied seq; local race → re-read IndexedDB, no network.
- Board: no wave filter (every wave; `?wave=N` only scrolls to it); "All results (N)"
  / "Top 5" replaces the old +/- per category.
- Limitation: viewers must be signed-in race members; there is no anonymous
  read-only feed on the server, so public mass viewing needs a backend change.

### Local ids and waves (missing rider cards, 2026-11-04)
- Every local rider/category/race id comes from `newLocalId()` (`utils/localId.ts`).
  IndexedDB and the Live board are keyed by `id`: a duplicate overwrites/hides a rider.
  Never `Date.now() + i` or `Date.now()*1000 + random` again. `loadSnapshot` drops
  riders sharing an id and lets the server snapshot restore each once (one-time
  `link.idRepair` reload per shared race; skipped while actions are pending).
- A category without a wave (`heat` empty) gets its wave from start times in the app.
  The server starts categories by wave, so Start first saves the derived waves
  (`freezeDerivedWaves`, all at once so nothing renumbers), and the engine starts a
  named wave-less category and gives it the wave.

### Import mapping: start / wave / class
- Wave (`heat`) is auto-mapped only from an explicit wave header (`גל`, wave, heat).
  `מקצה` is the category; `שעת זינוק` is the start time; a bare `זינוק` is mapped to
  start time only when its values are clock times, else left for the user (it can be
  a start group). `autoMapColumns(headers, sampleRows)`.

### Sign-in and where a new race is saved
- ONE sign-in system: the Commissaire server account (`/account`, `liveClient` session).
  The side menu's Register / Login opens `/account`, Logout calls `auth.logout()` and keeps
  every race on the device; `/login` redirects there. The old `/login`, `/otp`, `appStore`
  sign-up and `services/Auth.ts` are dead code (not reachable with a server configured).
- Create Race signed in: `saveRace` AWAITS `persistNewRace` (≤20 s) and the toast says
  "saved to the server" ONLY after the server answered; otherwise "saved on this device
  only. <reason>" and it keeps retrying (queue `commissaire.live.pendingPublish.v2`, per
  account — never published under another account). New races go up without categories
  (`publishRace(…, { allowEmpty: true })`); Team → Share still requires categories.
- Signed-out screen is `live/SignInForm.tsx`: Sign in / New account (repeat password +
  show/hide eye, proper `autoComplete` so phones save the password) / Forgot password.
  Emailed codes (`sendEmailCode` in `server/src/auth/auth.ts`) go ONLY to registered
  emails, max 3 per address per 24 h (`EMAIL_CODES_PER_DAY`), 60 s apart; a failed send
  isn't counted. `/auth/password-reset/confirm` sets the new password, marks the email
  verified and signs out other devices. Production with `MAIL_TRANSPORT=log` answers 503
  instead of pretending the email was sent.
- **Creating a race needs an account** (server builds): Create Race signed out → `/account?reason=create&next=/main?create=1`
  (explanation shown). Signed in → `syncMyRaces()` (download unlinked server races, catch up linked ones —
  matched by server uuid, no duplicates) behind `CreateRaceGate` (error + Retry), THEN the form. `saveRace` keeps
  a new race only once the server has it: refused / no connection → `discardUnsavedNewRace` + error, form stays
  (Done = retry); only a slow server (timeout) keeps it queued. Browsing needs an account (guests only open shared links); a build
  without a server still creates local races. A normal sign-in lands on My Races, which syncs on every visit (`AccountSync`); `SharedRacesSection` lists only server races not yet on this device.
- Older local races (created before this): never uploaded automatically. The race page
  badge (`LocalOnlyBadge`) offers "Sign in to save" / "Save to server" (`saveRaceToServer`).
  The Info tab opens with the server panel (`live/RaceServerAction.tsx`): orange rail + "Upload Race
  to Server" while local; green rail + sync state once linked, and (owner) ONE publish status button
  (`live/PublishControl.tsx`): solid red "Not published" / green "Published"; it opens a small modal
  with `PublicLink` (Publish/Unpublish, link, Copy, Share). The race header uses the same button (compact). The Share Race modal (local races) reuses `UploadPrompt` and
  `PublicLink` (`live/PublicLink.tsx`): a local race never calls the share API, it shows "Race not uploaded yet" + upload,
  then the link in place. Share errors go through `shareErrorText` (no bare "Not found").
- `publishRace` runs once per race at a time (in-tab map + Web Locks across tabs): two
  uploads of an empty race would create two server races.
- Start-list import into a SHARED race (wizard): `importIntoSharedRace` sends ONE
  `RidersImported` with the riders AND the missing categories, waits for the server, and
  only then catches the race up — nothing is written locally before. `importCheck.ts`
  runs the server's rules first (duplicate bib, bib already in race, no category, field
  limits) and names the rows; keep it in step with `newRider` (its test checks).
  Categories are built by `utils/categoriesFromRiders.ts` for local and shared races
  alike; the store's category builders still skip shared races. Other importers go
  through the bridge, which applies the same check and adds the categories to the Action.
- `tests/race-persistence.spec.ts` and `tests/cloud-sync.spec.ts` (PC ↔ phone sync) need a real API (`E2E_API_URL`); skipped otherwise.
- Dead-code check: `npx knip` (2026-11-04 cleanup removed 33 unreferenced files and 13 unused deps). Shared-code exports look unused to knip only because `server/` is outside its scan.

### Account isolation on one device (0.1.15 security fix)
- `public/sw.js` NEVER caches or answers `/api/*` or `/socket.io/*` (`isPrivate`). Before v3 it
  served same-origin GETs cache-first, so a phone replayed a previous account's `/me` (wrong email
  shown), race list and snapshots. v3 calls `skipWaiting()` on install (security), and `activate`
  copies only static entries out of old caches before deleting them. Bump `CACHE_VERSION` on change.
- Server: every `/api` response is `Cache-Control: no-store` + `Vary: Authorization` (`app.ts`).
- Client: `api()` fetches with `cache: "no-store"`; `purgeApiCache()` (Cache Storage) runs at
  start-up `/me`, sign-in, sign-out and before every `syncMyRaces`.
- The displayed user must be the token's account: `tokenSubject()` (JWT `sub`) — a stored or
  fetched profile for another id is dropped/refused (`stale_profile`).
- Signing in as a different account than `commissaire.live.lastUserId` runs `clearAccountState`
  (per-race access cache, sync, publish errors, open race). Races on the device stay.
- `raceVisibleToAccount`: an account with no server list yet sees only never-uploaded races, never
  another account's downloaded ones. `setLink` always records the race for the signed-in account.
- My Races sync: `live/AccountSync.tsx` on the main screen runs `syncMyRaces` on EVERY visit and on
  account change (no more once-per-session), shows syncing / synced N / failed + Retry.
  `syncMyRaces` is single-flight, stops if the account changes, and one failing race doesn't stop the rest.
- Tests: `services/live/__tests__/accountIsolation.test.ts`, `components/pwa/__tests__/serviceWorker.test.ts`,
  `server/test/no-store.test.ts`.

### Race Access Rules (0.2 Phase 1, branch feature/v0.2-phase1 — see docs/v2/)
- **Member writes are PER RACE.** `races."memberWrites"` (migration 011, default false). Off =
  only the owner writes (0.1.x behaviour; `phaseAccess` strips members' writes). The owner
  switches it in Team (`PUT /races/:uuid/member-writes`, audited, every joined socket gets the
  new access via `refreshRaceSockets`). `COMMISSAIRE_MEMBER_WRITES=1` = on everywhere (tests only).
- **Roles** (`src/shared/race/roles.ts`): admin, start, counter, checkin, **results** (0.2:
  LapCountCorrection/StatusCorrection via `results.update`; correction panel in Results →
  rider details, `results/ResultCorrection.tsx`), viewer. Finalize/Amend stay owner-only.
- **Admin delegation is owner-only** (`delegationError` / `isAdminLike` in shared access.ts):
  only the current owner grants admin or a Team write override, changes/removes an admin-like
  member, or withdraws an admin-like invitation. Invitation ACCEPT re-checks it against the
  current owner, so an admin can't demote/promote through an invitation.
- **Original creator** `races."createdByUserId"` (011; backfilled from snapshot seq 0, never in
  `RACE_COLUMNS`, written only by `insertRace`). Only the creator soft-deletes (even after
  `/transfer`, even if no longer a member); anyone else's delete hides for them. Legacy NULL
  creator → current owner.
- **Audit = `race_events` only.** Server-written `RaceAdmin` entries (`server/src/races/audit.ts`
  `logServerEvent`, same transaction as the change): published/unpublished, joinCodeRotated,
  invitationCreated/Revoked/Declined, ownerTransferred, hidden, deleted, memberWritesChanged.
  Never tokens, secrets or join codes. Devices can't send `RaceAdmin`.
- **Invitations:** `declinedAt` = its own status; a soft-deleted race's invitations are gone.
- **Rejected offline Actions are KEPT** in `live_outbox` (`rejected` field), never re-sent,
  per account, removed only by the user's Dismiss (`SyncBadge` → `RejectedActions` sheet) or
  with the race itself. Never delete them in code.
- Live (`heat/[heatId]`) requires `canOnScreen(race, "live", "update")`; `canOnScreen` stays
  permissive when no access is cached (an offline owner must reach Live; the server refuses).
- **Guests (signed out, server builds):** `live/AccountOnly.tsx` guards `/main` and every
  `/race/*` route → `/account?reason=guest&next=…`. A guest reads ONE race only through
  its share link `/share/:token` (`app/share/SharePage.tsx`, standalone: plain fetches of
  `/api/v1/public/*`, no session, no socket, no IndexedDB). Tabs: Info, Riders,
  Categories, Schedule, Board, Results.
- **Share links:** `server/src/public/shareToken.ts` — `base64url(uuid).HMAC` (stable,
  no table; `SHARE_LINK_SECRET`, default derived from `JWT_ACCESS_SECRET` — changing it
  breaks every link). A link opens ONLY a **published**, not deleted race
  (`races."publishedAt"`); unpublish → 404 at once. Owner: `GET /races/:uuid/share-link`,
  `PUT /races/:uuid/publication {published}`; UI `live/ShareRace.tsx` (Publish/Unpublish,
  Copy, Share). Public data = `projectPublicState` (no join code, owner id, phone,
  comments, check-in, IDs).
- **Guest polling:** `shared/race/guestPolling.ts` is the ONE rule (client stops, server
  answers 410 `polling_closed`): open until the race is finished or 24 h after its
  scheduled start (race date + earliest of race/category start time, Asia/Jerusalem;
  dates `YYYY-MM-DD` or `DD/MM/YYYY`). Every 10 s, paused while the tab is hidden.
- **My Races** lists only the signed-in account's races (+ never-uploaded ones):
  `raceVisibleToAccount` / `commissaire.live.accountRaces.<userId>`.

### Race deletion (never hard delete)
- `DELETE /races/:uuid` never removes rows. Owner + ACTIVE race → soft delete
  (`deletedAt`, also unpublished); everyone gets `410 race_deleted` (from
  `loadMembership`), the socket `race:revoked {deleted:true}`, and `GET /races` lists it
  in `removed` → devices call `removeDeletedRace` (link, outbox, local data). FINISHED
  race, or any member's delete → hidden for that user only (`race_hidden`).
- Client: `liveClient.deleteSharedRace` — offline deletes are queued
  (`commissaire.live.pendingDeletes.<userId>`) and sync never re-downloads them; queued
  Actions of a deleted race are dropped (an offline device can't restore it).
- Migration `server/sql/010-race-deletion-publishing.sql` (additive). The API refuses to
  start until it is applied (`REQUIRED_TABLES` has `race_hidden`).

### Releases: never ship a stale build
- 0.1.12 shipped an OLD `server/dist` (pack-release copied whatever was there). Now
  `server/deploy/pack-release.sh` requires HEAD == <sha> and a clean `server/` +
  `src/shared/`, deletes `dist/`, rebuilds, and refuses to pack unless every line of
  `server/deploy/release-markers.txt` is in `dist/server.js`. `pack-web-release.sh`
  checks HEAD, a clean tree, dist newer than the last source commit and
  `web-release-markers.txt`. Add a marker line for every new route/feature.
- Build the web app from PowerShell with `$env:VITE_SERVER_URL='/'` (Git Bash rewrites `/`).
- Never edit a published release; fixes go in a new version. Deploys are done by the
  Linux production agent from a GitHub release — never from this machine.

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
- Club dictionary: no UI; `clubDictionaryStore` entries (if any) are still applied by the import wizard
- Hebrew + English support required (use `dir="auto"` on text elements)
- Local data is IndexedDB; shared races sync with the Commissaire server (cloud PostgreSQL). Tests never use the production DB.

### Rapid Entry keypad (Live, 0.2.1–0.2.2 — prototype)
- Live has two modes: Cards (unchanged) | Keypad (`heat/[heatId]/rapidEntry/`), toggle + swipe
  (right → keypad), remembered per race (`commissaire.liveEntryMode.<race>`).
- Bibs match through a digit trie of the WAVE's riders (`bibIndex.ts`): complete → recorded at
  once; ambiguous (1 while 18/182 exist) → Enter only; prefix → wait; none → red after
  `INVALID_CLEAR_MS` (digits typed before that pause stay one invalid number). Timings in
  `rapidEntryConfig.ts` are UX experiments, not rules.
- Records through `recordLap(rider, "keypad", firstKeypressTime, { quiet, acceptedAt })`, which now
  returns a `LapOutcome` (card taps ignore it). Undo = existing `cancelAction`, latest lap only.
- History per wave in localStorage `commissaire.rapidEntry.<race>:heat:<wave>`.
- Voice is OFF by default (store v1 migration); the mic shows only when switched on in Race Setup.
- Start screen groups: `data-start-state` red notStarted / orange standing (countdown) / green started.
- 0.2.2: keypad is digits + a tall Enter only (no Backspace/Clear keys; the physical keyboard
  keeps Backspace/Escape). A unique bib clears the input first and records on the next tick.
  History labels are one word (`4 LEFT`, `FINISH`, `WAIT 23s`, `WAVE 2`, `UNKNOWN`); the ▲▼ arrows
  reorder THIS LIST only — never lap times or the official order. One compact top bar: mode
  switch + (cards) sync / (keypad) wave · clock; the Sync button is hidden on the keypad.
  Cards mode hides the wave-info chip and the entry row (Joker · Bib · RECAP) behind
  `SHOW_CARD_INFO_INPUT = false` in `heat/[heatId]/page.tsx` — code kept, flip to restore.
