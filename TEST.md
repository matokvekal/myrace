# Commissaire — Full Race-Day E2E Scenario

**Spec:** `tests/full-race-e2e.spec.ts`
**Start list:** `tests/fixtures/full-race.csv`
**Run it:** `npm run test` (whole suite) or `npm run test:full` (this scenario only)

Current state: **6/6 passing in ~52 s**, the full-race scenario itself in ~25 s.
Four of those six were failing before this work for reasons unrelated to what
they test — see findings U5, U6 and C7.

Everything below is what the test actually does, in order. Edit the constants at
the top of the spec (or the CSV) and the test follows along — that's the point of
this document: it's the scenario you can change and repeat.

---

## Test inventory — everything covered today

11 tests across 8 files. `npm run test` runs them all (~65 s).
**This is the list to point an agent at when you want "run the tests for what we
built so far".**

| # | File | Covers | Tasks |
|---|---|---|---|
| 1 | `full-race-e2e.spec.ts` | The full race day (below) — the big one | 18–31, 8 |
| 2 | `lap-recording.spec.ts` | Record a lap · 60 s minimum enforced · undo · DNF · DSQ | 29 |
| 3 | `csv-column-order.spec.ts` | Same start list with columns shuffled → identical riders + categories | 19, 20 |
| 4 | `create-race.spec.ts` | Creating a race with **no** riders file still works | 18 |
| 5 | `csv-import.spec.ts` | Import wizard path (Riders → Actions → CSV) | — |
| 6 | `time-parsing.spec.ts` | The one shared clock parser: `08:00`, `08:04:31`, ISO, AM/PM, junk | 26, 30 |
| 7 | `dns-dnf.spec.ts` | DNS/DNF toggles from the Schedule tab | — |
| 8 | `rider-edits.spec.ts` | Edit a rider's name + start time, values persist | — |
| 9 | `race-flow.spec.ts` | Demo race smoke: finish wave 1 → check in, start, finish wave 2 | — |
| 10 | `side-menu.spec.ts` | Feedback email link in the side menu | — |
| 11 | *(2nd test in `lap-recording`)* | DNF/DSQ move a rider off the racing grid | 29 |

### What the big scenario asserts, by area

- **Import** — 30 riders, 6 categories auto-derived with correct laps/waves, 2-wave schedule
- **Check-in** — Check All · one-tap DNS · DNS and Status menu stay in sync · Quick Add of 2 late entries
- **Start** — three staggered start groups per wave, each flips to RUNNING
- **Live** — 5-minute laps recorded by tapping · DNF after lap 1 · DSQ after lap 2 · commissaire notes saved
- **Early flag-off** — confirmation states the count, riders stay ⚑ ON TRACK, finish on next crossing
- **All Riders view** — every rider exactly once, correct status buckets, filters
- **Standings** — per-category, filter widens to All and narrows again
- **Boards / Results** — winners per category, real finish times, DNS/DNF/DSQ classified, column picker + localStorage
- **Export** — signed workbook, SHA-256 verified in Node, then verified in-app across valid / results-modified / unsigned

### Not covered (worth knowing)

Voice recognition, OCR/photo import, the map tab, cloud sync, multi-day races,
club dictionary, and PWA install. Also: the "Wait Ns" toast isn't asserted
(react-toastify doesn't animate under a frozen clock) — the refused lap is.

---

## How time works in this test

The whole race runs on a **fake clock** (`page.clock`), not on wall-clock time.
Two things in the app make this mandatory rather than a convenience:

| App behaviour | Where | Why it forces a fake clock |
|---|---|---|
| A rider can't record a second lap within 60 s | `MIN_LAP_MS`, `heat/[heatId]/page.tsx` | You cannot fake a 5-minute lap by clicking quickly |
| A card waits 300 ms after a tap to tell single-tap from double-tap | `RacingRider.tsx` | A tap only counts once the clock moves past that window |

So the test:

1. `page.clock.install({ time: RACE_DAY_START })` before the first navigation.
2. `fastForward(5 min)` between lap rounds.
3. `fastForward(400 ms)` after each tap, to settle the single/double-tap timer.

A ~40-minute race day therefore runs in seconds, and nothing drifts between
steps — the run is deterministic.

---

## Scenario knobs

All at the top of `tests/full-race-e2e.spec.ts`:

| Constant | Default | What it drives |
|---|---|---|
| `LAP_MINUTES` | `5` | Simulated time on course per lap |
| `RACE_DAY_START` | `2026-07-21T07:45` | Where the fake clock starts |
| `RACE_NAME` | `E2E Full Race` | Race created in step 2 |
| `WAVE_1` / `WAVE_2` | see below | Categories, laps, and which bibs get DNS/DNF/DSQ/notes |
| `LATE_ENTRIES` | bibs 6, 7 | Riders entered by hand on the day |

### The race being built

Two waves, three categories each, five riders each, **every category a different
lap count** — so lap counts, finish order and "still on track" behaviour are all
exercised differently.

| Wave | Start | Category | Laps | Bibs |
|---|---|---|---|---|
| 1 | 08:00 | Elite Men | 2 | 1–5 |
| 1 | 08:10 | Elite Women | 3 | 11–15 |
| 1 | 08:20 | Junior Men | 4 | 21–25 |
| 2 | 09:00 | Masters Men 30-39 | 3 | 31–35 |
| 2 | 09:10 | Masters Women 30-39 | 4 | 41–45 |
| 2 | 09:20 | Masters Men 50+ | 5 | 51–55 |

The staggered start times are deliberate: gaps inside a wave are under
`DEFAULT_WAVE_GAP_MINUTES` (30), so each wave holds **three separate start
groups** that can be started and flagged off independently. The 08:20 → 09:00 gap
is 40 minutes, which is what splits wave 1 from wave 2.

---

## The scenario, step by step

### 1. Terms gate
Fresh browser profile → the Terms & Conditions dialog is up. Tick the box, click
**Agree & Continue**. (Every test in a clean profile has to pass this.)

### 2. Create the race and upload the start list
`Create new race` → fill name and location → upload `full-race.csv` via
**Upload Riders File** → **Done**. Then open the race from the list.

The CSV is read by `saveRidersFromCsv`, which is **positional**, not
header-driven — the column order is fixed:

```
timeStartRace, heat, bibNumber, position_start, firstName, lastName, category, team, totalLaps
```

### 3. Verify the import
- Riders tab shows **30 riders**.
- Categories tab shows all six categories — they are auto-derived from the riders
  by `createCategoriesFromRiders`, which is also where each category's `laps`,
  `startTime` and `heat` come from.
- Schedule shows the six categories across two waves.

### 4. Wave 1 — check-in
- **Check All** checks in the whole wave.
- Bib **5** is set to **DNS** from the check-in row (Status → DNS). A DNS rider is
  excluded from the start and must never appear on the live board.
- **Two riders are added by hand** (`Quick Add Rider`): bibs **6** and **7** into
  Elite Men. They inherit the category's lap count and are checked in
  automatically — they race like anyone else.

### 5. Wave 1 — start
Each of the three start groups is started with **Start All**, one minute of
simulated time apart, and each flips to **RUNNING**.

### 6. Wave 1 — run it live
Phase switcher → **Live** (`/race/:id/heat/1`). Then per lap round:

1. Fast-forward 5 minutes.
2. Tap every card currently on the racing grid (one lap each).
3. After lap 1 → bib **15** is marked **DNF** (double-tap → DNF).
4. After lap 2 → bib **25** is marked **DSQ**.
5. After lap 3 → the **Junior Men** start group (4 laps) is **flagged off early**
   from the Grid, while its riders are still out on course.

Step 5 is the interesting one, and it's where the test found the most serious
bug. The riders still out there are *supposed* to stay on the grid with the
**⚑ ON TRACK** ribbon and finish on their next crossing. They don't — they are
force-finalized as finishers with a partial lap count. The test asserts what the
app actually does today and is commented with what to change when it's fixed;
see **L6** in the findings below.

Riders that complete their distance drop off the racing grid into **Finished**.

### 7. Wave 1 — notes, board, standings
- Commissaire **notes** are saved on two riders via the live modal (Save Note).
- **Board** sub-tab: every category shows a P1 — the winners.
- **Standings**: Schedule → the trophy button on a category → the per-category
  standing page → back.

### 8. Wave 1 — finish, then wave 2
**Finish Wave** → **Yes** → the wave reports *Wave 1 finished*. Then the entire
sequence 4–8 repeats for **wave 2** (DNS 35, DNF 45, DSQ 55, Masters Men 50+
flagged off early after lap 4). No late entries the second time.

### 9. Final boards
Both waves' boards show every category with a finisher count, and the Results tab
lists the field — including the two hand-added riders.

### 10. Export the race file, signed with a crypto token
Info tab → **Export to Excel** → **Export All**. The test captures the download
and verifies the workbook.

The export carries a **Signature** sheet (added for this scenario — see
`src/app/utils/raceExport.ts`):

| Field | Meaning |
|---|---|
| `version` | `commissaire-race-export/v1` |
| `algo` | `SHA-256` |
| `exportedBy` | Signed-in user's email/id, or `anonymous` |
| `exportedAt` | ISO timestamp |
| `nonce` | 16 random bytes, hex |
| `payload` | The exact string that was hashed |
| `token` | Lowercase hex SHA-256 of `payload` |

The payload commits to the race uuid, the category and rider counts, the
exporting user, the timestamp, the nonce, **and a digest of every rider's result**
(`id:bib:laps:status:raceStatus:position:elapsed`, sorted by id). The test:

1. recomputes SHA-256 of `payload` in Node and checks it equals `token`;
2. rebuilds the rider digest from the **Riders** sheet and checks it appears in
   the payload — so an edited placing or lap count would no longer verify;
3. confirms a one-character change to the payload produces a different hash.

That gives the file provenance (who exported it) and tamper-evidence (whether the
results were edited after export).

---

## Repeating / changing the scenario

- **Different field size or lap counts** → edit `tests/fixtures/full-race.csv`
  *and* the matching `WAVE_1` / `WAVE_2` blocks in the spec (the spec asserts
  against the plan, so the two must agree).
- **Faster run** → lower the lap counts in the CSV. Runtime is dominated by the
  number of taps (riders × laps).
- **Longer laps** → change `LAP_MINUTES`; nothing else needs to move.
- **More/fewer start groups per wave** → change the start times in the CSV. Gaps
  under 30 minutes stay in the same wave; a bigger gap starts a new wave.
- **Watch it run** → `npx playwright test full-race-e2e --headed`.
- **Debug a step** → `npx playwright test full-race-e2e --debug`, or open
  `playwright-report/` after a failure.

---

## App changes made to support this scenario

| File | Change |
|---|---|
| `src/app/utils/raceExport.ts` | Added the signed **Signature** sheet: `exportRaceToXlsx` is now `async`, returns an `ExportSignature`, and exports `buildSignaturePayload` / `riderResultsDigest` / `verifyExportToken` for verification |
| `src/app/race/[id]/info/Info.tsx` | Awaits the export, stamps it with the signed-in user, and surfaces failures as a toast |
| `src/app/race/[id]/categories/racingRider/RacingRider.tsx` | `data-testid="racing-rider-<bib>"` + `data-laps` |
| `src/app/race/[id]/categories/finishRider/FinishRider.tsx` | `data-testid="finish-rider-<bib>"` + `data-status` |
| `src/app/main/components/headerMain/HeaderMain.tsx` (+ CSS) | Side-menu feedback block: "Comments? Bugs?" with a `mailto:` link and a pre-filled subject carrying the app version |
| `src/app/legal/terms.ts` | New "6. Supported devices" section — Android is the tested platform, iOS expected to work but not deeply tested; `TERMS_VERSION` bumped to `2026-07-draft-2` so users re-accept |
| `tests/helpers.ts` | `acceptTerms()` + `selectWave()`, shared; `loadDemoRace()` now also navigates back from the demo's Live redirect — un-breaks the four existing specs |
| `tests/race-flow.spec.ts` | Uses the shared helper; now signs off the demo's already-running wave 1 before starting wave 2, because the app allows only one wave running at a time |
| `tests/side-menu.spec.ts` | New: guards the feedback email link |
| `playwright.config.ts` | `actionTimeout: 15s`, so a bad selector fails in seconds rather than consuming the whole test timeout |
| `package.json` | `npm run test` (whole suite) and `npm run test:full` (this scenario) |

---

# Second run — verification pass

Re-ran the whole suite from a clean `test-results/`, then checked every finding
from the first run against the current source.

## Result: 6/6 passed, 50.3 s (first run 52.4 s)

```
✓ csv-import.spec.ts        6.7s
✓ dns-dnf.spec.ts           4.5s
✓ full-race-e2e.spec.ts    23.1s
✓ race-flow.spec.ts         6.0s
✓ rider-edits.spec.ts       4.7s
✓ side-menu.spec.ts         1.4s
```

Nothing broke, and nothing flaked — same six passes, run-to-run variance under
4 %. `tsc --noEmit` is also clean.

## Are the bugs fixed? No — and that is the expected answer

**No application code was changed between the two runs.** The first run produced
a findings list; nobody has acted on it yet. So this pass is about confirming the
findings are real and still reproduce, not about seeing them go away. Each was
re-verified against the source rather than taken on trust.

### Still open (application bugs)

| # | Finding | Status | How it was re-verified |
|---|---|---|---|
| L6 | ⚑ ON TRACK is unreachable dead code | **Open** | `StartManager.tsx:594,653,685` still set `raceStatus: "finished"` on every rider. Also proven by the test *passing* — see note below |
| L7 | Every finish time in Results is blank | **Open** | `Results.tsx:31` still `new Date(rider.timeStartRace)` |
| L1 | `saveRace` doesn't await the start list | **Open** | `saveRace.ts:102` still `readAsText` with `setAddNewwRace(false)` on the next line |
| L2 | Add-Race CSV import is positional | **Open** | `insertRidersCsv.ts:38–46` still `row[0]`…`row[8]` |
| L3 | Two divergent CSV import paths | **Open** | Both parsers still present |
| L4 | `QuickAddRider` writes a stray `laps` field | **Open** | `QuickAddRider.tsx:44` |
| L5 | Standing category filter is a no-op | **Open** | `standing/[heatId]/page.tsx:196` — callback still only closes the modal |
| U1–U4 | Live-board coverage, DNS depth, flag-off discoverability, duplicate labels | **Open** | No UI changes |
| C1 | `heat/[heatId]/page.tsx` — 1,053 lines | **Open** | Unchanged |
| C4 | `StartManager.tsx` — 1,240 lines | **Open** | Unchanged |
| C2 | `parseTimeStr` duplication | **Open, worse than reported** | Re-counted: **5** copies, not 3. Severity raised to medium |

### Fixed and holding (test-infrastructure findings)

| # | Finding | Status | How it was re-verified |
|---|---|---|---|
| U5 | Terms gate broke the whole suite | **Fixed** | `acceptTerms()` in `helpers.ts:16`, used by `loadDemoRace` and both new specs; all 6 pass |
| U6 | Demo's Live redirect stranded tests | **Fixed** | `helpers.ts:36` detects `/heat/` and returns to Setup, retried via `toPass` |
| C6 | Duplicate `loadDemoRace` | **Fixed** | Exactly one definition remains (`helpers.ts:24`) |
| C7 | Demo seed and specs had drifted | **Fixed** | `race-flow.spec.ts` signs off wave 1, then runs wave 2 |

The underlying *product* gaps behind U5 and U6 are still open — there's still no
dev/test bypass for the terms gate, and the demo still bounces users to Live with
no way back signposted. Only the test-side symptom was addressed.

## A green test is evidence the bug is still there

Worth being explicit, because it's counter-intuitive: `full-race-e2e` **passing**
is a positive signal that **L6 is still broken**. The `flagOffEarly()` step
asserts today's wrong behaviour — riders forced to `FIN 3/4`, `Racing (0)` — so
the day someone fixes `endRace()`, that test goes red at exactly those lines,
with a comment saying what to change. The test is pinned to the bug on purpose.

L7 is handled the opposite way: the spec deliberately asserts nothing about the
Time column, so fixing it requires no test change at all.

## What the second run adds

1. **Determinism confirmed.** The fake clock does what it was brought in for —
   two runs of a ~40-minute simulated race day differ by ~2 s of wall time and
   produce identical results. The suite is safe to gate a CI pipeline on.
2. **One finding revised.** C2 was under-counted; five copies, not three, and it
   is the root cause behind L7 rather than a style nit.
3. **No regressions.** The export signing, the `data-testid` additions, the
   feedback link and the terms change all still pass, including the four
   pre-existing specs.

### Recommended order of attack

1. **L7** — one line, uses a helper that already exists, and it's currently
   showing every organiser a blank results sheet.
2. **L6** — a correctness bug that mis-records riders as finishers; the fix
   (leave `raceStatus: "running"` on flag-off) re-enables a feature that's
   already fully built.
3. **L1 + L2** — the import path, where a silent failure costs a whole start list.
4. **C2** — collapse onto `timeUtils`, which stops L7-class bugs recurring.

---

# Third pass — fixes applied

Bugs were transcribed into `BUGS.md` as numbered tasks (18–31) and worked through
one at a time. Every fix got a test, and the whole suite was re-run after each.

**All 14 tasks done. Suite grew 6 → 11 tests, all green (~65 s).**

| Task | Bug | Status |
|---|---|---|
| 30 | Blank finish times in Results (was L7) | ✅ Fixed + test |
| 31 | Riders on course recorded as finishers (was L6) | ✅ Fixed + test |
| 18 | `saveRace` didn't await the start list (was L1) | ✅ Fixed + test |
| 19 | Positional CSV import (was L2) | ✅ Fixed + test |
| 20 | Two divergent import paths (was L3) | ✅ Fixed — one detector *and* one row builder |
| 21 | Stray `laps` field (was L4) | ✅ Fixed |
| 22 | Standings category filter no-op (was L5) | ✅ Fixed + test |
| 23 | Early-finish confirmation wording (was U3) | ✅ Fixed + test |
| 24 | No full-wave status view (was U1) | ✅ Built + test |
| 25 | DNS buried at check-in (was U2) | ✅ Fixed + test |
| 26 | Duplicated time parsing (was C2) | ✅ 5 copies → 1 + test |
| 27 | No stable test hooks (was C3) | ✅ Added + migrated |
| 28 | Signature had no verifier | ✅ Built + test |
| 29 | Lap logic buried in a 1,053-line file (was C1) | ✅ Extracted to `useLapRecording` |

Two of these turned out to be worse than first reported:

- **22** was two bugs: the selection was discarded *and* the modal only ever
  listed the category you were already filtered to.
- **31**'s fix is confirmed as the original intent — `startGroup()` already
  contained a sweep for "rider still running whose category finished", which
  could never fire before and now does the job it was written for.

The L6 test inversion worked exactly as designed: `flagOffEarly()` was pinned to
the buggy behaviour, so fixing `endRace()` turned it red, and it was rewritten to
assert the ribbon, the "⚑ N still on track" count, and finish-on-next-crossing.

New tests added: `create-race.spec.ts` (no-file branch), `csv-column-order.spec.ts`
(same start list, shuffled columns → identical riders and categories),
`side-menu.spec.ts` (feedback link), `time-parsing.spec.ts` (the shared parser
against every format the app stores), `lap-recording.spec.ts` (record / 60 s
guard / undo / DNF / DSQ).

**Order mattered on task 29.** The lap-recording refactor is the riskiest change
in the set, so the safety net went in *first*: `lap-recording.spec.ts` was
written and passing against the old inline code, then the extraction happened,
then it passed unchanged. The heat page dropped 1,053 → 806 lines and the
extracted `useLapRecording` is now testable on its own.

**Two things found while fixing:**

- `npx eslint` cannot run in this repo at all — `.eslintrc.json` extends
  `next/core-web-vitals`, but this is a Vite app with no Next.js installed.
  Pre-existing and unrelated, but it means lint gates nothing today.
- react-toastify's toasts don't render under a frozen clock, so the "Wait Ns
  before next lap" toast isn't asserted — the refused lap is, which is the real
  contract.

---

# Findings — bugs, UX, logic and code

Raised while writing and running this scenario. Numbered for reference; severity
is my own judgement.

## Logic / correctness

**L6 — the ⚑ ON TRACK feature is unreachable dead code (high). Found by this test.**
Flagging off a start group while riders are still out on course is supposed to
keep them visible, ribboned **⚑ ON TRACK**, and let them finish on their next
crossing. None of that can happen, because the same action that ends the race
also finalizes the riders:

- `endRace()` (`StartManager.tsx:653`) and `finishWave()` (`:685`) set
  `raceStatus: "finished"` and `status: "finished"` on **every** rider in the
  category, explicitly including those still on the road.
- `isOnTrackAfterEnd()` (`heat/[heatId]/page.tsx:147`) is only ever consulted for
  riders in `runningRiders`, i.e. riders whose `raceStatus !== "finished"`.

So the predicate can never be true through the UI. Everything hanging off it is
dead: the ribbon in `RacingRider.tsx:96`, the "⚑ N still on track" counter
(`:869`), the sink-to-bottom ordering, and the "finish on next crossing
regardless of laps remaining" rule in `handleRiderClick` (`:186`).

Observed in this run: Junior Men were flagged off during lap 3 of 4. Expected
four riders ribboned on the grid; got `Racing (0)` and four cards reading
`FIN 3/4` — recorded as *finishers* despite never completing the distance.
That also corrupts the result: a partial-distance rider is ranked as a finisher
rather than being held open or classified.

This contradicts the project's own stated rule that ending a race must not hide
riders still on the road. Fix: `endRace`/`finishWave` should leave riders with
`raceStatus: "running"` (only closing the *category*), and let the existing
next-crossing logic finalize them — which is exactly what that code already
expects. The test currently asserts today's behaviour and is commented with what
to change once this is fixed.

**L7 — every finish time in the Results tab is blank (high). Found by this test.**
`riderElapsed()` in `results/Results.tsx:29` does:

```ts
const start = new Date(rider.timeStartRace).getTime();
```

but `timeStartRace` is a wall-clock string like `"08:04:31"` (written by
`StartManager.startGroup` via `toLocaleTimeString`). `new Date("08:04:31")` is
an Invalid Date, so `start` is `NaN`, the subtraction is `NaN`, and the render
guard `el && el !== Infinity` treats `NaN` as falsy — so the Time column shows
`—` for **every finisher**. Observed in this run: all 30 riders finished with a
recorded lap history and every single time cell reads `—`.

It's worse than a blank cell: `sortBy === "time"` sorts on the same `NaN`
(`:87`, `:91`), so the "Time" sort button silently does nothing, and "Place"
falls back to it.

The codebase already has the correct implementation — `riderTotalTime()` /
`parseClockTime()` in `utils/timeUtils.ts`, which handles the `HH:MM:SS` form
and is what `FinishRider` and `RiderLiveModal` use. `Results.tsx` should call it
instead of hand-rolling `new Date(...)`. This is the long-standing BUG-01 in
`docs/app-review.md`, still live in the Results tab.

The test deliberately does **not** assert on the Time column, so that fixing
this doesn't require touching the spec.

**L1 — `saveRace` doesn't wait for the start list to be parsed (high).**
`src/app/utils/saveRace.ts` kicks off `reader.readAsText(file)` and then
immediately calls `setAddNewwRace(false)` and returns. The `reader.onload`
handler that actually saves the riders runs later, unawaited. Open the race fast
enough and `createCategoriesFromRiders` runs against zero riders — and because
`race/[id]/page.tsx` only calls it when `cats.length === 0` on mount, you can land
on a race with riders but **no categories**, which means no schedule and no way to
start. Fix: make `saveRace` await the read (`await file.text()`), and show the
spinner until the riders are in.

**L2 — the CSV upload on Add Race is positional, not header-driven (high).**
`saveRidersFromCsv` reads `row[0]`…`row[8]` and ignores the header names
entirely — it only `console.warn`s if they don't match. Any real-world start list
whose columns are in a different order imports silently wrong (names into
categories, laps into teams). The app already has a proper header-mapping
importer (`CSVImportWizard`); the Add Race path should use it rather than a
second, weaker parser.

**L3 — two different CSV import paths with different capabilities (medium).**
Related to L2: `insertRidersCsv.ts` (Add Race) and `CSVImportWizard`
(Riders → Actions → Import) disagree on club-dictionary mapping, heat-name
handling and field coverage. Two parsers for one job is a standing source of
"it imported differently last time" bugs.

**L4 — `QuickAddRider` writes a `laps` field that isn't on `RiderProps` (low).**
It sets both `totalLaps` and `laps` from the category. `laps` isn't part of the
rider model; it's dead data in IndexedDB and invites someone to read the wrong
one later. Per `CLAUDE.md`, laps must resolve through
`effectiveTotalLaps()`/`withCategoryLaps()` anyway.

**L5 — `Standing`'s category filter modal does nothing (low).**
In `standing/[heatId]/page.tsx`, `CategoryModal`'s `selectCategory` callback only
closes the modal — the chosen category is discarded. The filter icon looks
functional and isn't.

## UX

**U1 — no way to see the whole field on the live board (medium).**
The Live grid only shows riders whose race has started, and finished riders move
to a separate section. During a staggered wave there's no single view of "all 15
riders in this wave and where each one is". Commissaires asked for exactly this
when a rider is missing.

**U2 — DNS is buried at check-in (low).**
Marking a rider DNS takes: find row → **Status** → modal → **DNS**. It's the most
common pre-start action on the list. A direct DNS control on the row (next to the
check button) would save three taps per rider, on a screen used under time
pressure.

**U3 — the early-flag-off flow is undiscoverable (medium).**
Finishing a start group while riders are still on course is a genuinely important
feature (the ⚑ ON TRACK behaviour is well built), but nothing in the Grid tells
you that's what **Finish** does to riders still out there. The confirmation says
only "End race?". It should say how many riders are still on course and what will
happen to them.

**U4 — "Export to Excel" appears twice with different meanings (low).**
The Info tab button and the modal title are both "Export to Excel"; the modal's
confirm is "Export All". Fine once you know it, but the button → modal → button
chain reads as if the first click should have exported.

**U5 — the Terms gate silently broke the entire existing test suite (medium).**
The gate blocks every control on first load in a fresh profile, so all four
pre-existing specs (`race-flow`, `csv-import`, `dns-dnf`, `rider-edits`) started
failing on their very first click the moment it landed — nothing to do with what
they test. Fixed here by adding `acceptTerms()` to `tests/helpers.ts` and calling
it from `loadDemoRace()`.

Worth adding a proper bypass anyway — a `localStorage` seed helper or an env flag
— so automation, demos and screenshots don't have to script their way past a
legal dialog. More generally: a modal that gates the whole app should come with
the test-path story attached.

**U6 — the demo's "jump straight to Live" redirect fights the user (low).**
`race/[id]/page.tsx:64` bounces the first open of the demo race to
`/race/:id/heat/1`, one-shot per session. Combined with U5 this was the second
reason the existing suite was failing: tests land on the live screen instead of
the tab bar. For a human it's also disorienting — you click "Try Demo Race" and
arrive somewhere you didn't ask for, with no indication that a Setup view exists.
A "you're watching a race in progress — go to Setup" affordance on the Live
screen would cost nothing and remove the surprise. `loadDemoRace()` now navigates
back to Setup explicitly.

## Code

**C1 — `heat/[heatId]/page.tsx` is ~1,050 lines doing far too much (medium).**
Lap recording, undo/action log, voice recognition, filtering, the clear-board
flow and four modals live in one component. The lap-recording core
(`handleRiderClick`, `handleRevertLap`) is the highest-risk code in the app and
is the hardest part to test in isolation. It wants to be a hook
(`useLapRecording`) plus a thin view.

**C2 — `parseTimeStr` is copy-pasted five times (medium — revised up).**
Re-counted during the second run: `heat/[heatId]/page.tsx`, `LiveBoard.tsx`,
`LiveCards.tsx`, `RacingRider.tsx` (as `parseTimeToMs`) and
`components/voice/RiderActionLog.tsx` — while `timeUtils.ts` already owns time
parsing (`parseClockTime`). Five hand-rolled copies of the one function the
project's own notes say must not drift, and L7 is what that drift looks like when
a sixth site rolls its own with `new Date()` instead. Raised from low to medium:
this isn't tidiness, it's the root cause of the timing bugs.

**C3 — no `data-testid` anywhere before this work (low).**
Existing tests reach into CSS-module class names (`[class*="dataRow"]`), which
break whenever a class is renamed. This change adds `data-testid` to
`RacingRider` and `FinishRider`; the same treatment on rows, cards and tabs would
make the suite far less brittle.

**C7 — the demo seed and the tests drifted apart (medium, fixed).**
`demoSeed.ts` was changed to seed the demo **mid-race** (`DEMO_SEED_VERSION = "2"`,
wave 1 already checked in and on course). `race-flow.spec.ts` still assumed the
old unstarted seed, so its check-in and start steps had nothing to act on. When a
fixture is the entry point for every test, changing it needs the specs updated in
the same commit — otherwise the suite rots quietly. Now targets wave 2.

**C6 — `race-flow.spec.ts` had its own copy of `loadDemoRace` (low, fixed).**
A second, subtly different copy of the helper that `helpers.ts` already exported.
It meant the terms-gate fix landed in one place and not the other, and the spec
kept failing for a reason that looked unrelated. Now imports the shared helper.

**C4 — `StartManager.tsx` at ~1,240 lines repeats the confirm-inline pattern
(low).** "End race?/Yes/Cancel" and "Finish whole wave?/Yes/Cancel" are the same
widget written twice. A small `<ConfirmInline>` would remove the duplication and
give the buttons stable, distinguishable labels (right now both confirms are just
"Yes", which is also why tests have to scope them to a container).

**C5 — export was synchronous and unsigned (addressed here).**
`exportRaceToXlsx` now returns a signature and is `async`; `Info.tsx` awaits it
and surfaces failures via a toast. Worth adding the matching **verify** side in
the app (import an xlsx → tell the user whether its token still checks out),
since the token is only half useful without a verifier in the UI.
