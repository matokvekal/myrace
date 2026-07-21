
importent at this page all bugs and fitures you have to write some smal comment at the agents /read me so we know all the fitures of the app
after finish fix bug or fiture re organize the md files AGENT BUGS 

---
## STATUS INDEX  (updated 2026-07-21)

| #  | Item | Status |
|----|------|--------|
| 1  | Playwright / service-worker error | ⏳ BLOCKED — needs the real error text (see note under #1) |
| 2  | Flatten sub-categories → one category per age band | ✅ DONE |
| 3  | Bib vs Standing separated on import | ✅ DONE |
| 4  | Riders Actions popup clipped on narrow phones | ✅ DONE |
| 5  | Hide missing rider image / flag (was showing alt text) | ✅ DONE |
| 6  | Auto-color checkbox + distinct colours for overlapping starts | ✅ DONE |
| 7  | Category laps now propagate to riders (0/5 not 0/0) | ✅ DONE |
| 8  | Results column picker, saved to localStorage | ✅ DONE |
| 9  | Status order DNF → DSQ → DNS | ✅ DONE |
| 10 | Live cancel restores rider to exact prior state + slot | ✅ DONE |
| 11 | Downloadable example.csv | ✅ DONE |
| 12 | Cleanup pass (dead files, single source of truth) | ⏳ DEFERRED — fix ESLint first |
| 13 | Race image crash on save | ✅ DONE |
| 14 | Live timer freezes at stop + gated Clear button | ✅ DONE |
| 15 | Narrow-phone timer seconds hidden by wave chip | ✅ DONE |
| 16 | Terms & Conditions page + startup acceptance gate | ✅ DONE (draft text) |

Full write-ups per item below.

---

1. ❯ whay error     // The app registers a service worker; block it so tests always hit fresh code.
  at dev server (port 3000) and drives the app in Chromium.
   */
  export default defineConfig({
    testDir: "./tests",
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
⧉ Selected 7 lines from playwright.config.ts in Visual Studio Code

   ⏳ BLOCKED — NEEDS FROM YOU (Claude): I can't see an actual error here, just a
   snippet of playwright.config.ts. To fix #1, paste the real error text below —
   run `npx playwright test` (or `npm run test:e2e`) and copy what it prints
   (the red error/stack). Separately, ESLint is currently broken project-wide
   (`.eslintrc.json` extends `next/core-web-vitals`, but this is a Vite app, not
   Next) — say the word and I'll fix that too. Until the error is here, #1 stays
   parked and I'll keep going down the list.

2 
❯ sub categories make me trobles i want to have only categories  so sya we have man pro  and man masters  so man masters can be 19-29 then master man 30 to 39 so on so that category per each age area but pro man are all one category not inner so we will not use sub category at all  nead secure fix
 2. ✅ DONE — sub categories

   **Decision:** old races keep their sub-categories (untouched, still render);
   new races are flat — one category per age band. Sub-category column is no
   longer importable.

   **Done:**
   - Predefined templates flattened: "Man Masters" + [19-29…60+] → separate
     categories "Man Masters 19-29", "Man Masters 30-39", etc. (both
     `Categories.tsx` and `CategoryManager.tsx`). "Man Pro"/Elite stay single.
   - Sub-category authoring removed: the text input in the Categories "create
     new" form, and the add/remove sub-category UI + selector strip in
     `CategoryManager.tsx`. New categories always get `subCategory: null`.
   - Legacy templates in localStorage that still carry sub-categories are
     expanded into flat ones on load ("Man Masters" + "30-39" → "Man Masters
     30-39"), so the picker can never offer a nested category again.
   - CSV/photo import: `subCategory` added to `IGNORED_FIELDS` — dropped from
     the mapping dropdown and never written onto a rider. Its keywords are
     deliberately KEPT so a "תת קטגוריה" / "Age Group" column is still absorbed
     by that field; without this it fuzzy-matches "קטגוריה" and overwrites the
     real category column. Verified: category column survives in he/en/age-group
     wordings.
   - `EditRiders` paste-import no longer reads a sub-category column.
   - `RiderDetailModal` only shows the sub-category input for riders that
     already have one (legacy), so new races never see the field.

   **Note:** `subCategory` stays on `RiderProps`/`CategoryProps` and in the
   category identity key (`name::subCategory`) on purpose — that is what keeps
   existing races rendering correctly. It is simply never authored anymore.

3. ✅ DONE — check that bib and staging are diferent in some case riders get bib number same as the standing , standinf is for eaxmple can be like they have point before the race so we set the firs rider  at first row so each row befor race hole the best 5 or 6 riders then next row but some new riders get number not same as the place since thay not have placed yesy so we need to check that bib is bib number and standing is other

   **Cause:** `autoMapColumns` claimed fields left-to-right, so a leading seeding
   column headed `מס'` / `No.` (an exact bib alias) grabbed `bibNumber` and locked
   the real `מספר רוכב` column out of it — bib ended up holding the standing order.
   Separately `standing` was parsed on import then thrown away (`RiderProps` had no
   such field).
   **Fix:** each field now goes to the column that matches it best anywhere in the
   row (not the first one); vague headers are capped at confidence 75 so a specific
   header always wins, and a vague header that loses its best field is left unmapped
   for manual mapping instead of cascading onto an unrelated field (it was landing
   on `heat`). Serial/seed headers (`מס״ד`, `seed`, `serial`, `order`) now map to
   `standing`, and `standing` is persisted on the rider.
   Files: `services/csvMapper.ts`, `utils/csvFieldDetector.ts`, `types/csv.types.ts`,
   `types/types.ts`, `components/csv/CSVImportWizard.tsx`, `utils/fieldMappingDictionary.json`

4. ✅ DONE — at riders the sort in smal mobile screen is set  to the  left and part is hidden need to fix move more right th popup

   **Which popup:** the Sort control is a native `<select>` (the browser
   positions its list — CSS can't clip it), so the clipped popup is the
   **Actions menu** (Import / Scan / Edit) — the only custom popup on the Riders
   bar. Treated that as the one meant.
   **Cause:** `.topBar` is `flex-wrap: wrap` + `space-between`. On a narrow phone
   the Actions button wraps to its own row and lands on the LEFT, but its menu is
   anchored `right: 0` (opens leftward) → it ran off the left edge and was hidden.
   **Fix:** `.actionsMenu` now has `margin-left: auto`, so it stays right-aligned
   even when wrapped — the menu opens leftward from the right edge and stays on
   screen. Also capped the menu at `max-width: calc(100vw - 24px)`.
   File: `race/[id]/riders/riders.module.css`
   ⚠️ If you actually meant a different popup, point me at the screen.

5. ✅ DONE — if no image of rider of no flag dont show  since now if not we see the alt -bad

   **Bigger cause than it looked:** flags used a hardcoded `/international/…`,
   but prod is served from `/commissire-race/` (BASE_URL) — so EVERY flag 404'd
   in production and showed its alt text. Also, no-flag riders defaulted to
   `"il"` (mislabelled them), and only 4 flag files exist (gb, il, it, us).
   **Fix:** new `RiderFlag` component — resolves via BASE_URL, renders nothing
   when there's no flag or the file 404s, `alt=""` so it degrades to nothing.
   Used in `RiderCard`, `Riders`, `StandingCard`. `RiderDetailModal` now falls
   back to its placeholder on a dead image URL.
   Files: `race/components/riderFlag/RiderFlag.tsx` (new), `riderCard/RiderCard.tsx`,
   `race/[id]/riders/Riders.tsx`, `standingCard/StandingCard.tsx`, `riderDetailModal/RiderDetailModal.tsx`

6/ ✅ DONE — wehn create new race add checkbox(auto selected default) to have Auto color
since some case the orginizer want to select t coloryou must test allt that nothing brakebtw/
any way at auto color dot choose similar color for close time starts

   **Checkbox:** "Auto color categories" on the new-race form, on by default.
   Stored as `race.autoColor` (undefined = true, so existing races unaffected).

   **Similar colours:** old scheme was `COLORS[index % length]` in creation
   order, with no awareness of time. Confirmed the palette has adjacent
   look-alikes — Steel Blue vs Dodger Blue at ΔE 34.9 (reads as the same colour
   on a phone). New `utils/colorAssignment.ts` works in CIE L*a*b* and gives each
   category the colour furthest from the ones it can overlap with.

   **Window is 90 min, not the start gap** — per your note (race = 15 min–1.5 h,
   waves ~10 min apart), waves up to ~90 min apart can still be ON COURSE
   together, which is when a mis-tap happens. Colours recycle outside that.

   **Verified:** 14-category schedule, 81 overlapping pairs, 0 too similar;
   undated categories still distinct. Typecheck + build pass.
   Files: `utils/colorAssignment.ts` (new), `stores/categoryStore.ts`,
   `types/types.ts`, `utils/saveRace.ts`, `main/addRace/AddRace.tsx` + css

7/ ✅ DONE — after seting laps(if not from file) riders didnt get the laps number for example if category got 5 laps rider in that category has 0/0 insted of 0/5

   **Cause:** four different places changed `category.laps`, but only the edit
   form pushed the new value onto the riders. The Quick-Laps panel, the inline
   +/- steppers on the category card, and `CategorySettingsModal` all wrote the
   category and left riders at 0. Riders imported without a laps column start at
   0, so they stayed 0/0. `AddRider` also copied laps off a sibling rider
   instead of the category, inheriting the same 0.

   **Fix (write side):** added `updateCategoryAndSyncRiders()` in
   `Categories.tsx` — every laps change now goes through it. Fixed the same
   omission in `CategorySettingsModal` (it synced colour but not laps, and
   matched riders by name only, so a legacy nested category overwrote its
   siblings). `AddRider` now takes laps from the category.

   **Fix (read side):** added `effectiveTotalLaps()` / `withCategoryLaps()` to
   `Schedule.tsx` — the category is the source of truth, a rider's `totalLaps`
   is just a cache. Applied in `LiveCards`, `LiveBoard`, `Results`, and the heat
   page (which had its own inline copy of this logic, now shared). This also
   heals races already saved with 0.

   **Not just cosmetic:** `LiveCards` gates finishing on `rider.totalLaps > 0`,
   so a rider at 0 could never finish and would lap forever.

   **Deliberate:** laps resolve as `category.laps || rider.totalLaps` — a
   category at 0/null means "not set yet" and must NOT wipe lap counts that came
   from the start list. Verified with 8 cases incl. legacy sub-categories.
   Files: `race/[id]/schedule/Schedule.tsx`, `race/[id]/categories/Categories.tsx`,
   `race/components/modals/CategorySettingsModal.tsx`, `race/components/addRider/AddRider.tsx`,
   `race/[id]/raceMode/{LiveCards,LiveBoard}.tsx`, `race/[id]/results/Results.tsx`,
   `race/[id]/heat/[heatId]/page.tsx`

8. ✅ V — DONE — at results - give in good ux way to select what fields to sho since we cant see the name in some case also save it as default at local storage

   **E2E test added afterwards** (it had none): the Results step in
   `full-race-e2e.spec.ts` hides the Bib column via the Columns menu, asserts the
   bibs disappear while the rider name stays visible, asserts the choice was
   written to `localStorage.resultsVisibleFields`, then restores it.

   **Cause:** the Results row showed a fixed set of columns (place, bib, name,
   laps, time, status). On a narrow phone the fixed-width columns squeezed the
   name (`flex:1`) down to an ellipsis.
   **Fix:** added a "Columns" picker (checkboxes) in the Results toolbar. Bib /
   Laps / Time / Status can each be toggled; Place and Name are always shown
   (Name is the whole point). Hiding columns reflows the flex row and gives the
   name room. The choice is saved to localStorage (`resultsVisibleFields`) and
   restored as the default next time. Verified: default = all on, saved subset
   restored, unknown/corrupt keys ignored.
   Files: `race/[id]/results/Results.tsx`, `race/[id]/results/results.module.css`

9. ✅ DONE — when we at live click at rider twice we want to give his status the DNF first up then DSQ
the other  this make sense

   The double-tap modal (`RiderLiveModal`) ALREADY ordered DNF → DSQ → DNS.
   The wrong order was in `StatusModal` (Check-In tab's "Status" button):
   `finished, running, standing, DNF, DSQ, DNS` — DNF was 4th, behind internal
   states you never set by hand. Reordered to `DNF, DSQ, DNS, standing, running,
   finished`.
   ⚠️ If you meant a different screen, say which — it's a one-line move.
   File: `race/components/modals/StatusModal.tsx`

10 ✅ DONE — at live i i click eider then i regret and tap cancell the rider still at the end of riders down we must bring it to same as it was befor with all same data as was

   **Cause:** tapping appends the rider to `displayOrder` after 1s. Cancel
   reverted lap *data* but never touched `displayOrder`. The revert was also
   lossy (rebuilt from `lapsDetails`, silently dropping `elapsedTimeFromStart`
   and `position_category`), and cancelling inside the 1s window didn't stop the
   pending move — it fired anyway and re-dropped the rider.
   **Fix:** each action now carries `prevRider` (exact pre-tap snapshot) +
   `prevOrderIndex`. Cancel restores byte-for-byte, splices them back into their
   original slot, and clears the pending timer. `handleRevertLap` reuses the same
   snapshot. Falls back to the old revert for actions logged before this change.
   **Verified:** 7 ordering cases (first/middle/last, 2-rider, single, finished
   rider re-inserted, out-of-range index clamps).
   File: `race/[id]/heat/[heatId]/page.tsx`

11 ✅ DONE — at uploading excell i wand some button that show example and point it to some downloadable excell/csv name it example.csv   or excell so i can fill it for users  then build me 1

   **Built** `public/example.csv` — 10 riders, 10 Hebrew columns, UTF-8 BOM so
   Excel opens Hebrew correctly. Sample data teaches the rules the other bugs
   exposed: bib ≠ דירוג on every row (incl. a new rider with blank ranking),
   flat categories per age band, Pro as one category, laps filled in.
   **UI:** "Download example.csv" in the upload step (via BASE_URL so it works on
   Pages). Refreshed the Supported Fields list (showed Position, not Standing).
   **Verified:** all 10 columns auto-map correctly through the real
   `autoMapColumns`; BOM present; no row has bib == standing.
   Files: `public/example.csv` (new), `components/csv/UploadStep.tsx` + css

12
 i need to go write the bugs.md what you did and else at thois before i go do quick                                        /btw when start demo race some cards has to bee at 0 laps some at finish some dnf like real race also some wave not start…
  /btw we did it before at any time at race before in after i can download race compilte file as excel json csv and other s…
                                                                                  
13 ✅ DONE — when create new race i take image for the race but save that image crash the app

   **Two real defects in the create-race path:**

   1. **Duplicate IDB write.** `saveRace` wrote the race with `db.add("races")`
      AND `insertRace` wrote the SAME id again with `db.add` → duplicate-key
      `ConstraintError`. Removed the direct write from `saveRace` (insertRace is
      now the single writer — the source-of-truth fix you asked for) and switched
      `insertRace` from `add` to `put` so a re-save can never throw.

   2. **Raw full-res image stored on any failure = the crash.** `handleImageUpload`
      caught a compression failure and fell back to storing the RAW camera photo
      (a multi-MB base64) straight into the race. That bloats IndexedDB and
      OOM-crashes rendering on phones. Phone cameras also shoot HEIC, which the
      old `<img>`-based decoder often can't read, so the failure path fired
      routinely.

   **Fixes:**
   - `compressImage` now decodes via `createImageBitmap` first (handles HEIC,
     large photos, and EXIF orientation; decodes straight from the File), with
     the `<img>` path as fallback. Guards `toDataURL` (iOS returns "data:," for
     oversized canvases) and frees the bitmap. Never stores raw oversized bytes.
   - `handleImageUpload` no longer stores the raw image on failure — it keeps the
     current cover and tells the user (e.g. HEIC unsupported). Also resets the
     file input so re-picking the same file works.

   **Verified:** typecheck + build pass; byte-cap math and the data-URL guard
   unit-checked. (Exact on-device crash not reproducible on Windows, but the
   raw-blob storage path that causes it is now closed.)
   Files: `utils/compressImage.ts`, `main/addRace/AddRace.tsx`,
   `utils/saveRace.ts`, `stores/racesStore.ts`


14 ✅ DONE — when we stop race or wave the timer at live became 0, no it has to stop at the stop timer

you need to stop the timer and it has to show the race timer stop

but add there button clear(with appruved) it will seen only afetr wave  or all starts for that wave  finish
the clear will set timer to 0   and remuve all riders cards also those finish also those at the track like clean all

it not must but can be use
any way
sytart new wave will start the timer from 0 and remuve previues riders card and add the curents starts riders

   **Cause of the 0:** the live clock derived its value from a rider with
   `raceStatus === "running"`. Stopping the wave flips every rider to
   "finished", so no running rider was found → the clock fell back to
   00:00:00 instead of holding the elapsed time.

   **Fix — freeze at stop:** the clock now takes the wave start from the
   earliest `timeStartRace` of ANY started rider (survives the stop), and when
   the wave is stopped (every started category `finished`) it freezes at the
   latest category `finishedAt` instead of `now`. Verified: running→20:00,
   stopped→frozen 12:47, cleared→00:00:00.

   **Clear button:** appears on the live screen ONLY once the wave is fully
   stopped (`waveStopped`). Tapping it asks for confirmation, then resets the
   clock to 00:00:00 and removes every card (racing, on-track, finished, DNF/…).
   It's view-only — rider results stay in the Results tab. Resets automatically
   when the wave (heatId) changes.

   **New wave from 0:** each wave is its own heat route, so a new wave already
   shows its own riders and its own clock from 0; the cleared flag resets on the
   heatId change.
   Files: `race/[id]/heat/[heatId]/page.tsx`, `race/[id]/heat/[heatId]/heat.module.css`


15 . ✅ DONE — at live in narow phone size the right top filter of categories hide part of timer so we do no t see the seconds - need to fix

   **Cause:** on the live heat screen `.timerRow` centered the clock while the
   wave chip (Wave N + category colour dots, top-right) was `position:absolute;
   right:0` — it floated ON TOP of the clock, so on narrow phones the clock's
   right edge (the seconds) sat under the chip.
   **Fix:** `.timerRow` is now a 3-column grid (`1fr auto 1fr`) — clock centred in
   the middle column, chip in its own right column, so they can never overlap.
   Under 380px the clock spacing shrinks and the chip's colour dots hide (they're
   decorative) before the time ever loses a digit.
   File: `race/[id]/heat/[heatId]/heat.module.css`

16 ✅ DONE — add term and condition page write them lowyer page  standart of using the  app
for 2 main issu not to copy etc , but free use ..
and not oenwer resposebility

so each user at start the app(i see 2 pages) must check  that he read those condituion call the doc ument  and save it later i will daa things there

   **Built** (standard DRAFT terms — marked as placeholder, not lawyer-reviewed,
   per your go-ahead):
   - `legal/terms.ts` — the T&C content as editable data (version + dated
     sections). Covers the points you named: free to use; no copying/
     redistribution; provided as-is with no warranty; no owner liability; your
     data; changes. **This is the only file you edit later** — both the page and
     the startup gate read from it.
   - `/terms` page — full scrollable terms.
   - `TermsGate` — a blocking startup overlay (rendered globally in `App.tsx`)
     shown until the user ticks "I have read and agree" (with a link to the full
     /terms page) and taps Agree & Continue. It does NOT cover the /terms page
     itself so the terms stay readable.
   - `legal/termsAcceptance.ts` — single source of truth for acceptance,
     persisted in localStorage and **versioned**: bump `TERMS_VERSION` when you
     change the wording and every user is re-asked once. Verified: fresh user
     prompted, accepted user not, version bump re-prompts.
   Files: `legal/terms.ts` (new), `legal/termsAcceptance.ts` (new),
   `terms/page.tsx` + css (new), `components/legal/TermsGate.tsx` + css (new),
   `App.tsx`


agfter run test
## Implementation Tasks — Priority Order

### General Rules

* Do not break or redesign the existing UI.
* Preserve the current behavior unless the task explicitly requires a change.
* Make small, focused changes.
* Add a test for every fix.
* Run the existing test suite after every change.
* Manually verify the affected flow.
* Do not include unrelated refactoring in the same pull request.
* If something is unclear, ask before making assumptions.
* Do not ask unnecessary questions. Collect related questions and ask them together only when they block implementation.

---

### 18. ✅ V — DONE — Wait for Rider Import Before Opening the Race — Critical

   **Fixed:** `saveRace` now does `await file.text()` and awaits
   `saveRidersFromCsv` before closing the create screen. Previously it fired a
   `FileReader` and returned immediately, so opening the new race could beat the
   import — and since `createCategoriesFromRiders` only runs on mount when there
   are no categories, you could land on a race with riders but **no categories,
   no schedule and no way to start**. Import failures now surface instead of
   being swallowed (the screen stays open rather than silently losing the field).
   No UI change — `AddRace` already awaited `saveRace` and shows "Saving…".
   **Tests:** the E2E scenario opens the race immediately after creation and
   asserts 30 riders, 6 categories with correct laps, and a 2-wave schedule; new
   `tests/create-race.spec.ts` covers the no-file branch.
   **Verified:** 7/7 green.
   File: `utils/saveRace.ts`

`saveRace` must wait until the CSV file is fully parsed and all riders are saved before closing the Create Race screen.

Do not perform a large refactor. Keep the current UI and flow unchanged.

**Required validation:**

* Create a race with a CSV file.
* Open the race immediately.
* Verify that all riders exist.
* Verify that categories were created.
* Verify that the schedule was created.
* Verify that creating a race without a file still works.
* Run the full E2E race scenario.

---

### 19. ✅ V — DONE — Import CSV Columns by Header Name — Critical

   **Fixed:** `saveRidersFromCsv` no longer reads `row[0]`…`row[8]`. It runs the
   headers through `autoMapColumns` (the wizard's detector) to build a
   field→column map, then reads every value by field. Also picks up fields the
   positional parser ignored entirely — `middleName`, `points`, `federation`,
   `fullName` (split via `splitFullName`), and `standing` vs `position`.
   **Clear validation error:** if neither a bib column nor any name column can be
   found, it throws naming the missing fields and listing the detected headers,
   instead of importing 30 blank riders.
   **Test:** new `tests/csv-column-order.spec.ts` imports the same start list
   twice — once in the original column order, once with the columns shuffled to
   `lastName,firstName,category,team,totalLaps,bibNumber,heat,timeStartRace,position_start`
   — and asserts the rendered riders and the derived categories are identical.
   **Verified:** 8/8 green. The existing `full-race.csv` still imports unchanged.
   Files: `utils/insertRidersCsv.ts`, `tests/fixtures/full-race-shuffled.csv`

The CSV importer currently reads columns by position, such as `row[0]`, `row[1]`, and so on.

Change the importer to map values using column headers.

Existing CSV files must remain fully supported.

**Required validation:**

* Import the current CSV file.
* Change the order of its columns and import it again.
* Verify that both imports produce identical riders and categories.
* Verify that a missing required column produces a clear validation error.
* Verify that no incorrect data is silently imported.

---

### 20. ✅ V — DONE — Use One Rider Import Implementation — High Priority

   **Both flows now share the whole pipeline**, in two steps:

   1. *Column detection* — `autoMapColumns` (`services/csvMapper`), so Create
      Race and the wizard agree on Hebrew/English headers and on the
      bib-vs-standing rules from task 3.
   2. *Row building* — `rowToRider` moved out of `CSVImportWizard.tsx` into
      `services/riderRowMapper.ts` and used by both. Create Race also picked up
      the wizard's text-heat handling ("Wave A" → 1) for free.

   Create Race no longer has any rider-construction logic of its own: it parses,
   maps, and delegates. The fields it silently dropped before — `middleName`,
   `points`, `federation`, `fullName` splitting, `standing` — now come across
   because it's the same builder.

   **Old implementation not deleted, as instructed** — the wizard still owns its
   extra steps (club dictionary, multi-day, validation, preview); those are
   layers on top, not a second parser.

   **Validated:** `tests/csv-column-order.spec.ts` imports the same file twice
   with different column orders and diffs the rendered riders and derived
   categories — names, bibs, categories, teams, start times, waves and laps all
   identical. `tests/csv-import.spec.ts` still covers the wizard path.
   **Verified:** 11/11 green.
   Files: `services/riderRowMapper.ts` (new), `utils/insertRidersCsv.ts`,
   `components/csv/CSVImportWizard.tsx`

The Create Race flow and the Riders Import flow must use the same import and validation logic.

Do not immediately remove the old implementation. First confirm that the shared implementation produces the same or better results.

**Required validation:**

Import the same file through both flows and compare:

* Rider names.
* Bib numbers.
* Categories.
* Teams or clubs.
* Start times.
* Waves or heats.
* Total laps.

Both flows must produce the same result.

---

### 21. ✅ V — DONE — Remove the Invalid `laps` Field from Quick Add Rider

   **Fixed:** dropped the stray `laps` property; only `totalLaps` (the real
   `RiderProps` field) is written. Lap resolution logic untouched — laps still
   come from the category via `effectiveTotalLaps()`/`withCategoryLaps()`.
   **Verified:** the E2E scenario hand-adds two riders into a 2-lap category and
   they finish on lap 2 exactly like the imported field. Full suite green.
   File: `race/[id]/raceMode/QuickAddRider.tsx`

`QuickAddRider` currently stores both `totalLaps` and `laps`.

Only the supported rider model field should be stored. Do not change the current lap calculation logic.

**Required validation:**

* Add a rider manually.
* Verify that the rider receives the category lap count.
* Start the race.
* Verify that the rider finishes after the correct number of laps.
* Verify that existing manually added riders still work.

---

### 22. ✅ V — DONE — Fix the Category Filter on the Standings Screen

   **Two defects, not one.** The selection was discarded (the callback only
   closed the modal), AND the modal built its list from the already-filtered
   riders — so it could only ever offer the single category you were looking at.
   **Fixed:** the shown category is now `selectedCategory` state, seeded from the
   `?category=` param and driven by the modal; "All" widens to the whole race.
   The modal's list now comes from the race's real categories. Header and empty
   state follow the selection. No redesign — same modal, same layout.
   **Test:** the E2E standings step now reads the rider count, switches to "All"
   (count grows), then to another category (count matches exactly).
   **Verified:** full suite green.
   File: `race/[id]/standing/[heatId]/page.tsx`

The category selection modal currently closes without applying the selected category.

Connect the selected category to the existing standings filter.

Do not redesign the modal or standings UI.

**Required validation:**

* Select a category.
* Verify that only riders from that category are displayed.
* Clear the filter.
* Verify that all riders are displayed again.
* Switch between several categories.
* Verify that filtering does not modify stored results or positions.

---

### 23. ✅ V — DONE — Improve the Early Finish Confirmation Message

   *(Was blocked by task 31 — the ON TRACK behaviour it promises didn't exist.
   31 is fixed, so this now tells the truth.)*

   **Fixed:** the inline confirm now reads "End race? N riders still on course —
   they stay on Live marked **ON TRACK** and finish on their next crossing", with
   correct singular/plural. With nobody out it reads "End race? Everyone is in."
   Count excludes DNF/DSQ/DNS. No change to the early-finish logic itself.
   **Test:** the E2E flag-off step asserts the count and both promises.
   **Verified:** full suite green.
   File: `race/[id]/raceMode/StartManager.tsx`


When a start group is finished while riders are still on the course, the confirmation must display:

* The number of riders still on the course.
* That they will remain visible as `ON TRACK`.
* That they will finish on their next crossing.

Do not change the existing early-finish logic. This task should only make the behavior clear to the user.

**Required validation:**

* Finish a group while riders are still racing.
* Verify that the displayed rider count is correct.
* Confirm the action.
* Verify that riders remain visible as `ON TRACK`.
* Verify that they finish on their next crossing exactly as before.
* Verify that finishing a group with no riders on course still works.

---

### 24. ✅ V — DONE — Add a Full Wave Status View

   **Built:** a fourth race-mode sub-tab, **All Riders**, next to Grid /
   Check-In / Board. Lists every rider in the selected wave exactly once with one
   of seven statuses — Not started, Racing, On track, Finished, DNS, DNF, DSQ —
   plus bib, name, category and laps. Filter chips carry live counts; ordering is
   status → position → bib, so whoever is racing is at the top.
   **Read-only and additive:** it never records a lap and never mutates a rider.
   The Live view and lap recording are untouched.
   "On track" is derived the same way the live screen does it (rider still
   running, category finished) — so it stays correct after task 31.
   **Test:** with staggered start groups, asserts every rider appears exactly
   once (including hand-added late entries), no duplicate rows, DNS/DNF/DSQ
   bucketed correctly, and that filtering narrows and restores without loss.
   **Verified:** 9/9 green.
   Files: `race/[id]/raceMode/WaveStatus.tsx` (new),
   `race/[id]/raceMode/waveStatus.module.css` (new),
   `race/[id]/raceMode/RaceMode.tsx`, `race/[id]/raceMode/raceMode.module.css`

Add a simple view or filter that displays every rider in the selected wave with their current status:

* Not started.
* Racing.
* On track.
* Finished.
* DNS.
* DNF.
* DSQ.

Do not replace or change the default Live view.

**Required validation:**

* Test a wave with multiple staggered start groups.
* Verify that every rider appears exactly once.
* Verify that statuses update during the race.
* Verify that the current Live view remains unchanged.
* Verify that the new view does not affect lap recording.

---

### 25. ✅ V — DONE — Add a Direct DNS Action to the Check-In Row

   **Fixed:** a one-tap `DNS` chip sits between the check circle and the Status
   button. Three taps (Status → modal → DNS) become one. It also un-checks the
   rider, since a DNS never takes the line. Styled as a tinted sibling of
   `.statusTrigger` so the destructive action reads differently without changing
   the row layout. The Status menu is untouched and still available.
   **Both controls stay in sync** — they write the same `status` field. Once a
   rider is out, the row collapses to the existing inline badge, and tapping that
   opens the Status menu to clear it.
   **Test:** the E2E check-in step now marks DNS via the new chip, clears it via
   the Status menu, and re-marks via the menu — asserting the DNS counter each
   time, and that the rider never reaches the Live board.
   **Verified:** 9/9 green.
   Files: `race/[id]/raceMode/CheckIn.tsx`, `race/[id]/raceMode/checkIn.module.css`

Add a simple direct DNS action beside the existing check-in controls.

Keep the existing Status menu available.

Do not change the general row layout more than necessary.

**Required validation:**

* Mark a rider as DNS using the new action.
* Verify that the rider is excluded from the start.
* Verify that the rider does not appear on the Live racing board.
* Change the status through the existing Status menu.
* Verify that both controls remain synchronized.

---

### 26. ✅ V — DONE — Move Time Parsing to a Shared Utility

   **Fixed:** deleted **five** hand-rolled copies — `parseTimeStr` in
   `heat/[heatId]/page.tsx`, `LiveBoard.tsx`, `LiveCards.tsx` and `parseTimeToMs`
   in `RacingRider.tsx`, `components/voice/RiderActionLog.tsx`. All now call
   `parseClockTime` from `utils/timeUtils`; added `parseClockTimeMs` there for
   the two call sites that only wanted epoch ms.
   **Strictly a superset:** the copies handled `HH:MM[:SS]` and ISO only.
   `parseClockTime` also handles AM/PM and returns `null` on junk instead of an
   Invalid Date — which is precisely the failure mode behind task 30.
   **Test:** new `tests/time-parsing.spec.ts` runs the real module in the browser
   over `08:00`, `08:10`, `09:20`, `08:04:31`, ISO, `1:05 PM`, `12:30 AM`, and
   empty/null/garbage.
   **Verified:** 9/9 green — start times, lap times, finish times and staggered
   start groups all unchanged through the full E2E scenario.
   Files: `utils/timeUtils.ts`, `race/[id]/heat/[heatId]/page.tsx`,
   `race/[id]/raceMode/{LiveBoard,LiveCards}.tsx`,
   `race/[id]/categories/racingRider/RacingRider.tsx`,
   `components/voice/RiderActionLog.tsx`

Replace duplicated time parsing implementations with one shared utility.

Do not change the accepted time format or calculated output.

**Required validation:**

Test values such as:

* `08:00`
* `08:10`
* `09:20`

Also verify:

* Start-time calculations.
* Lap times.
* Finish times.
* Staggered start groups.
* Full E2E results before and after the change.

---

### 27. ✅ V — DONE — Add Stable `data-testid` Attributes

   **Added:** `racing-rider-<bib>` + `data-laps`, `finish-rider-<bib>` +
   `data-status`, `checkin-row-<bib>` + `data-checked`/`data-status`,
   `start-all`, `finish-start-group`, `finish-wave`, `confirm-yes`,
   `confirm-yes-wave`, `verify-result` + `data-status`.
   The two confirm buttons were both just "Yes", which is why tests previously
   had to scope them to a container — they're now individually addressable.
   **Migrated:** the E2E spec now uses testids for check-in rows and every
   start/finish/confirm control. CSS-module selectors are kept where they still
   read well (`[class*="categoryRow"]`, `[class*="startBlock"]`) rather than
   ripped out, per "do not remove existing selectors until replacements are
   stable".
   **No visual change:** attributes only — no CSS, structure or copy touched.
   **Verified:** 9/9 green.
   Files: `race/[id]/raceMode/{CheckIn,StartManager}.tsx`,
   `race/[id]/categories/{racingRider/RacingRider,finishRider/FinishRider}.tsx`,
   `race/[id]/info/Info.tsx`, `tests/full-race-e2e.spec.ts`

   **Tabs** are deliberately left alone — the phase switcher already exposes
   proper `role="tab"` names, which is a better selector than a testid.

Add stable test identifiers to critical elements:

* Racing rider cards.
* Finished rider cards.
* Check-in rows.
* Start buttons.
* Finish buttons.
* Tabs.
* Confirmation controls.

Do not change CSS, visual structure, or user-visible text unless required.

**Required validation:**

* Update selected tests to use `data-testid`.
* Run the entire test suite.
* Verify that the UI looks and behaves exactly as before.
* Do not remove existing selectors until the replacement tests are stable.

---

### 28. ✅ V — DONE — Add Excel Signature Verification

   **Built:** "Verify signature" button next to Export/Import on the Info tab.
   Pick a workbook and it reports one of four states, colour-coded, without
   importing anything (read-only, so a suspect file is safe to inspect):

   * **valid** — token matches and the rider rows still hash to the signed digest
   * **results-modified** — signature authentic, but results changed since export
   * **invalid** — token doesn't match its own payload (signature block edited)
   * **unsigned** — no Signature sheet (older export, or not one of ours)

   Valid/modified results also show **who** exported it and **when**.
   Uses the existing `commissaire-race-export/v1` format via
   `verifyRaceWorkbook()` — no second signing scheme.
   **Test:** the E2E export step now verifies the real downloaded file, then a
   copy with one lap value changed, a copy with one position changed, and a copy
   with the Signature sheet deleted — asserting all four verdicts.
   **Verified:** exporting is unchanged; full E2E green.
   Files: `utils/raceExport.ts`, `race/[id]/info/Info.tsx`,
   `race/[id]/info/info.module.css`

Add a way to select an exported race workbook and verify its existing signature.

The verification result should clearly show:

* Whether the signature is valid.
* Whether race results were changed.
* Who exported the file.
* When it was exported.

Use the existing signature format. Do not create a second signing format.

**Required validation:**

* Verify an unchanged exported file.
* Change one lap value and verify that validation fails.
* Change one position and verify that validation fails.
* Test a workbook without a `Signature` sheet.
* Display a clear message for unsupported or invalid files.
* Confirm that exporting files still works as before.

---

### 29. ✅ V — DONE — Gradually Extract Live Lap Logic

   **Safety net first.** Before touching anything, added
   `tests/lap-recording.spec.ts` covering the exact list this task names: record
   a lap, refuse a second inside 60 s, accept it after, undo a lap, DNF, DSQ.
   (Normal finish, early finish with ON TRACK and the full scenario were already
   covered by `full-race-e2e`.) Both specs passed BEFORE and AFTER the move.

   **Extracted** `useLapRecording` — `recordLap`, `revertLap`, `cancelAction`,
   `logStatusChange`, `clearTimers`, plus the `riderActions` log, the flash
   state and the three timer refs. Logic moved verbatim: same debounce, same
   `MIN_LAP_MS` guard, same `calculatePositions` ordering, same cloud events,
   same drop-to-end-of-queue timing, same exact-snapshot undo.

   **Scope held deliberately narrow** — the Live screen was NOT rewritten.
   Filtering, voice, the modals, the clear-board flow and all rendering stay in
   the component; it just calls the hook now. Public behaviour and UI unchanged.

   The page drops **1,053 → 806 lines**, and the riskiest code in the app is now
   testable on its own.
   **Verified:** 11/11 green.
   Files: `race/[id]/heat/[heatId]/useLapRecording.ts` (new),
   `race/[id]/heat/[heatId]/page.tsx`, `tests/lap-recording.spec.ts` (new)

   *Note: `npx eslint` can't run at all in this repo — `.eslintrc.json` extends
   `next/core-web-vitals`, but this is a Vite app with no Next.js installed.
   Pre-existing and unrelated, but it means lint is not gating anything.*

Do not rewrite the Live screen.

As the first step, extract only lap recording and lap rollback logic into a dedicated hook, such as `useLapRecording`.

Do not change the UI or public behavior.

**Required validation:**

* Record a lap.
* Prevent a second lap within 60 seconds.
* Undo a lap.
* Mark DNF.
* Mark DSQ.
* Complete a normal finish.
* Complete an early finish with `ON TRACK`.
* Run the full E2E scenario before and after the extraction.

---

### 30. ✅ V — DONE — Fix Blank Finish Times in the Results Tab — Critical

**Missing from the original list. Found by the E2E run.**

   **Fixed:** `riderElapsed()` now uses `parseClockTime()` from `utils/timeUtils`
   instead of `new Date(...)`, and returns `Infinity` (not `NaN`) for unparseable
   or negative values so the render guard and the sort comparator both behave.
   **Test added:** `full-race-e2e.spec.ts` now asserts every finisher's row shows
   a real `HH:MM:SS`, and that DNS/DNF/DSQ rows show none.
   **Verified:** full E2E green (34.1 s), typecheck clean.
   File: `race/[id]/results/Results.tsx`

Every finisher's time in the Results tab renders as `—`, for every rider, in
every category.

`riderElapsed()` in `race/[id]/results/Results.tsx` does
`new Date(rider.timeStartRace)`, but `timeStartRace` is a wall-clock string like
`"08:04:31"` (written by `StartManager.startGroup` via `toLocaleTimeString`).
`new Date("08:04:31")` is an Invalid Date → `NaN` → the render guard
`el && el !== Infinity` treats `NaN` as falsy → `—`.

It also silently breaks sorting: `sortBy === "time"` and the `place` fallback
both compare `NaN`, so the Time sort button does nothing.

`utils/timeUtils.ts` already has the correct implementation (`parseClockTime`,
`riderTotalTime`) — used by `FinishRider` and `RiderLiveModal`. Reuse it. Do not
write a third parser.

**Required validation:**

* Run a race to a finish and open Results.
* Verify every finisher shows a real elapsed time, not `—`.
* Verify DNS/DNF/DSQ riders still show no time.
* Verify sorting by Time orders riders correctly.
* Verify staggered start groups each measure from their own start.
* Run the full E2E race scenario.

---

### 31. ✅ V — DONE — Riders Still on Course Are Wrongly Recorded as Finishers — Critical

**Missing from the original list. Found by the E2E run.**

   **Fixed:** both `endRace()` and `finishWave()` now go through one new helper,
   `closeOutCategoryRiders()`. It finalizes only riders who are genuinely done —
   already `raceStatus: "finished"`, or classified DNF/DSQ/DNS — and **leaves
   riders still on the road untouched**, so they keep `raceStatus: "running"`.
   The category closes; the rider does not.
   **Confirmation this was the original intent:** `startGroup()` already contains
   a sweep for "rider still running whose category is finished", which could
   never fire before. It now does the job it was written for.
   **Test:** `flagOffEarly()` in `full-race-e2e.spec.ts` now asserts the intended
   behaviour — ribbon visible, "⚑ N still on track" count correct, and the rider
   finishing on their next crossing regardless of laps remaining.
   **Verified:** full E2E green (40.9 s), typecheck clean. Also unblocks task 23.
   File: `race/[id]/raceMode/StartManager.tsx`

Flagging off a start group while riders are still out is supposed to keep them
visible with an `ON TRACK` ribbon and let them finish on their next crossing.
None of that can happen.

`endRace()` and `finishWave()` in `race/[id]/raceMode/StartManager.tsx` set
`raceStatus: "finished"` **and** `status: "finished"` on every rider in the
category, explicitly including riders still on the road.
`isOnTrackAfterEnd()` in `heat/[heatId]/page.tsx` only ever runs against riders
whose `raceStatus !== "finished"`, so it can never be true.

Everything built on it is therefore dead code: the ribbon in `RacingRider`, the
"⚑ N still on track" counter, the sink-to-bottom ordering, and the "finish on
next crossing regardless of laps remaining" rule in `handleRiderClick`.

Observed in the E2E run: Junior Men were flagged off during lap 3 of 4. Result
was `Racing (0)` and four cards reading `FIN 3/4` — riders recorded as
**finishers of a distance they never completed**. That is a results-integrity
bug, not a display bug.

Fix: ending a start group should close the **category**, and leave riders who
are still out with `raceStatus: "running"`. The existing next-crossing logic
then finalizes them correctly. Riders already finished, DNF/DSQ/DNS keep their
status.

**Required validation:**

* Flag off a group while riders are still racing.
* Verify those riders stay on the racing grid with the `ON TRACK` ribbon.
* Verify the "⚑ N still on track" counter shows the right number.
* Verify each finishes on their next crossing and is then classified.
* Verify a group with nobody on course still finishes cleanly as before.
* Verify starting the next wave leaves no ghost riders behind.
* Run the full E2E race scenario.

---

## Recommended Delivery Order

Implement tasks in this order:

1. **Tasks 30–31: results integrity.** Both corrupt or hide real race results;
   31 also unblocks 23.
2. Tasks 18–20: import reliability.
3. Tasks 21–23: correctness and race operation clarity.
4. Tasks 24–25: UI improvements without changing existing workflows.
5. Tasks 26–27: code and test stability.
6. Task 28: signature verification.
7. Task 29: controlled refactoring only after all previous flows are stable.

Every pull request should remain small, reviewable, and easy to revert.
