# Commissaire — Business Rules Catalog (for testing)

**Last updated:** 2026-07-14
**Purpose:** One place listing every behavioral rule the app enforces, each with a
stable ID, the source of truth in code, and a suggested test. Use the IDs as test
names. Rules are extracted from the actual implementation — if code changes, update
the referenced rule.

> Status vocabulary is defined once in **§0** and referenced everywhere else.

---

## §0 — Data model & status vocabulary

Source: `src/app/types/types.ts:117-121`

| Field | Values | Meaning |
|---|---|---|
| `Rider.raceStatus` | `upcoming` \| `running` \| `finished` | Where the rider is in *this race run*. |
| `Rider.status` | `standing` \| `running` \| `finished` \| `DNF` \| `DSQ` \| `DNS` | Result/eligibility status. `DNF`/`DSQ`/`DNS` = "out". |
| `Rider.position_start` | `number \| null` | Imported seeding/standing number. |
| `Rider.timeStartRace` | `"HH:MM:SS"` string | Wall-clock start of the rider's wave (see §7). |
| `Category.status` | `upcoming` \| `running` \| `finished` | Wave/start lifecycle. |
| `Category.heat` | number | **The wave number** (single source of truth — see RULE-WAV-01). |

- **RULE-MOD-01** — "Out" statuses are exactly `DNF`, `DSQ`, `DNS`. Any rule that says
  "not out" means `status ∉ {DNF, DSQ, DNS}`.
- **RULE-MOD-02** — A rider "on track" ⇔ `raceStatus === "running"`. "Completed" ⇔
  `raceStatus === "finished"`.

---

## §1 — Wave & schedule rules

Source: `src/app/race/[id]/schedule/Schedule.tsx`

- **RULE-WAV-01** — The wave a category belongs to **is** `category.heat`. There is no
  separate wave field. (`Schedule.tsx:91`)
- **RULE-WAV-02** — A rider belongs to a category only when **name AND sub-category
  both match** (`riderInCategory`). A shared category name (e.g. "Masters Men") in two
  different waves must not collide. (`Schedule.tsx:47-56`)
  - *Test:* two categories with same name, different `subCategory`, in different waves →
    a rider maps to exactly one.
- **RULE-WAV-03** — Default wave gap = **30 minutes** (`DEFAULT_WAVE_GAP_MINUTES`). (`Schedule.tsx:44`)
- **RULE-WAV-04** — If **any** category has `heat > 0`, the schedule is in *explicit-wave
  mode*: categories are grouped by their `heat` number (not by time). (`Schedule.tsx:91,105`)
- **RULE-WAV-05** — In explicit-wave mode, categories that have a start time but **no**
  wave are appended as time-derived waves **after** the last assigned wave, splitting into
  a new wave whenever the start-time gap exceeds the wave gap. (`Schedule.tsx:112-124`)
- **RULE-WAV-06** — With no explicit waves at all, waves are derived purely from start-time
  gaps: a gap greater than the wave gap starts a new wave. (`Schedule.tsx:130-152`)
- **RULE-WAV-07** — A wave's start time is **locked** once the wave has started or finished.
  (`Schedule.tsx:157`)

---

## §2 — Check-in rules

Source: `src/app/race/[id]/raceMode/CheckIn.tsx`

- **RULE-CHK-01** — The check-in list for a wave contains exactly the riders in the race whose
  category is in the wave (`riderInCategory`). (`CheckIn.tsx:33-35`)
- **RULE-CHK-02** — Toggling check-in flips `rider.checked` and requires the `CHECKIN_RIDER`
  permission; without it, the toggle is a no-op. (`CheckIn.tsx:84-88`)
- **RULE-CHK-03** — "Check All" checks every currently-filtered rider who is **not already
  checked** and **not out** (§RULE-MOD-01). It never touches out riders. (`CheckIn.tsx:90-97`)
- **RULE-CHK-04** — "All accounted for" ⇔ every filtered rider is either `checked` or out.
  (`CheckIn.tsx:99-101`)
- **RULE-CHK-05** — Once the wave is active (any category `running` or `finished`), check-in
  is **locked**: a banner shows, check buttons are disabled, and only status changes are
  allowed. (`CheckIn.tsx:103-105,153-157,230-234`)
- **RULE-CHK-06** — Check-in is always grouped Wave (start slot) → Category. Sort = Standing/Bib/Name, asc/desc, within category or whole wave. Standing is `standing ?? position_start`; riders without standing sort last.
- **RULE-CHK-07** — "+ Add rider" sits in each category block (category fixed); bib must be unique in the race.
- **RULE-CHK-08** — "✎ Bib" edits a rider's bib inline (unique per race, persisted, logged as `RIDER_EDITED`); disabled once the race is running.
  Scope may be per-category or overall across the wave. (`CheckIn.tsx:48-60`)
- **RULE-CHK-07** — Counts shown: number `checked`, number `DNS`, and total wave riders.
  (`CheckIn.tsx:294-297`)

---

## §3 — Start / StartManager rules

Source: `src/app/race/[id]/raceMode/StartManager.tsx`

### Start eligibility (blocks the Start button)

- **RULE-STA-01** — **Only one wave may run at a time.** If any category *outside this wave*
  has `status === "running"`, starting this wave is blocked with an error. (`StartManager.tsx:318-321,550-555`)
- **RULE-STA-02** — A start group is invalid (start blocked) if it has **no categories**
  assigned. (`StartManager.tsx:504-507`)
- **RULE-STA-03** — A category with **no laps configured** (`laps` missing or ≤ 0) blocks the
  start. (`StartManager.tsx:510-512`)
- **RULE-STA-04** — A category with **no assigned riders** (excluding `DNS`) blocks the start.
  (`StartManager.tsx:513-517`)
- **RULE-STA-05** — A category with **any un-checked, non-out rider** blocks the start.
  (`StartManager.tsx:519-526`)

### Effects of starting a wave

- **RULE-STA-06** — On start, `race.status` becomes `running`. (`StartManager.tsx:568`)
- **RULE-STA-07** — On start, any leftover rider from a *previous* wave who is still
  `raceStatus === "running"` while their category is already `finished` is **finalized**
  (`raceStatus → finished`; `status → finished` unless out) — so no "ghost" riders remain on
  Live. (`StartManager.tsx:576-591`)
- **RULE-STA-08** — For each `upcoming` category in the group: `status → running`,
  `lapsCounter → 0`, rider count recorded. Already-started categories are skipped.
  (`StartManager.tsx:593-606`)
- **RULE-STA-09** — Each non-`DNS` rider in a started category gets: `raceStatus → running`,
  `timeStartRace = now` (HH:MM:SS), `lapsCounter → 0`, `viewOrder = position_start ?? index+1`.
  DNS riders are **not** started. (`StartManager.tsx:595-615`)
- **RULE-STA-10** — `timeStartRace` is written as a 24-hour **`"HH:MM:SS"`** string via
  `toLocaleTimeString("en-GB")`. (`StartManager.tsx:562-566`) — see §7.
- **RULE-STA-11** — Wave-time controls (−30s / set-to-now / +30s) are **locked** once the wave
  has started. (`StartManager.tsx:853-869`)

### Ending a wave (Finish)

- **RULE-STA-12** — On end, each `running` category → `finished` with `finishedAt = now`.
  (`StartManager.tsx:631-634`)
- **RULE-STA-13** — Riders who already **completed** (`raceStatus finished`) and are not out
  are finalized to `status finished` and their `elapsedTimeFromStart` is recorded.
  (`StartManager.tsx:638-651`)
- **RULE-STA-14** — **Model A:** riders still on the track (`raceStatus running`) at Finish
  **keep** `raceStatus running` and stay visible on Live (flagged "still on track"). They are
  only finalized when the next wave is started (RULE-STA-07). Ending a race must never hide a
  rider still on the road. (`StartManager.tsx:643-651`)

---

## §4 — Live lap-recording rules (heat screen)

Source: `src/app/race/[id]/heat/[heatId]/page.tsx`

- **RULE-LAP-01** — Only riders whose category has started (`raceStatus !== "upcoming"`) appear
  on the live heat screen. (`page.tsx:117-125`)
- **RULE-LAP-02** — A lap click is a **no-op** if the rider already reached `totalLaps`, or
  `raceStatus === "finished"`. (`page.tsx:145`)
- **RULE-LAP-03** — Marking a lap requires the `MARK_LAP` permission (else a warning toast and
  no change). (`page.tsx:147-150`)
- **RULE-LAP-04** — **Debounce:** a second action on the *same rider* within **500 ms** is
  ignored. (`page.tsx:154-160`)
- **RULE-LAP-05** — **Minimum lap time = 1 minute** (`MIN_LAP_MS = 60000`). A lap crossing sooner
  than 60 s after the rider's last `timeArrive` is rejected with a "wait Ns" toast. (`page.tsx:39,162-170`)
- **RULE-LAP-06** — A valid lap increments `lapsCounter`, sets `timeArrive = now`, and updates
  `elapsedLastLap` and `elapsedTimeFromStart`. (`page.tsx:172-192`)
- **RULE-LAP-07** — A rider **finishes** on the crossing where `lapsCounter >= totalLaps`,
  **or** where the category has already ended (rider was on track after the flag — this crossing
  is their last, regardless of remaining laps). (`page.tsx:177-180`)
- **RULE-LAP-08** — `speed_kph` is computed from the configured circuit length only if
  `circuitKm` is set; otherwise it is omitted. (`page.tsx:181-183`)
- **RULE-LAP-09** — **Revert lap:** if `lapsCounter <= 0` it is a no-op; otherwise `lapsCounter`
  decrements, `timeArrive` is restored to the previous crossing, and `raceStatus → running`
  (un-finishing the rider if needed). (`page.tsx:330-349`)
- **RULE-LAP-10** — Setting a rider `DNF`/`DSQ`/`DNS` requires `MARK_DNS` (for DNS) or `MARK_DNF`
  (for DNF/DSQ). The status is applied and `raceStatus → finished` (out of the running grid).
  (`page.tsx:370-392`)

---

## §5 — Position / ranking rules

Source: `src/app/utils/calculatePosition.ts`

- **RULE-POS-01** — Ranking **excludes** `DNF`, `DNS`, and `DSQ` riders. (`calculatePosition.ts:7-9`)
- **RULE-POS-02** — Sort order (both per-category and overall): **more laps first**, then
  **earlier `timeArrive` first**. (`calculatePosition.ts:21-29,38-45`)
- **RULE-POS-03** — `position_category` is the 1-based rank within the rider's category;
  `position_race` is the 1-based overall rank. (`calculatePosition.ts:32-33,48-49`)
- **RULE-POS-04** — *(Known defect — BUG-03, confirmed still open)* `calculatePositions`
  mutates rider objects in place rather than returning copies. Tests should not rely on
  input immutability. (`calculatePosition.ts` L61 — see `BUGS.md` item 6)

---

## §6 — Live Board rules

Source: `src/app/race/[id]/raceMode/LiveBoard.tsx`

- **RULE-BRD-01** — Only categories that have **started** (`running` or `finished`) appear on the
  board. Not-yet-started categories/riders are excluded. (`LiveBoard.tsx:46-53`)
- **RULE-BRD-02** — `DNF` and `DSQ` riders are **shown** as "out" (they were in the race). `DNS`
  riders are **hidden** (never started). (`LiveBoard.tsx:103,114-115`)
- **RULE-BRD-03** — A category reads **done** when its `status === "finished"`, or when it has
  active riders and none are still on track while at least one has finished. (`LiveBoard.tsx:106`)
- **RULE-BRD-04** — Categories are ordered finished-first (most recently `finishedAt` first),
  then the rest. (`LiveBoard.tsx:56-65`)
- **RULE-BRD-05** — Podium mode shows the top 3 or top 5 (per-category toggle); medals apply to
  the top 3. (`LiveBoard.tsx:107-113,156-165`)

---

## §7 — Time parsing & formatting rules

Source: `src/app/utils/timeUtils.ts`

- **RULE-TIM-01** — `timeStartRace` is a **`"HH:MM:SS"`** string (legacy values may be ISO or
  12-hour locale). It must be parsed with `parseClockTime`, **never** `new Date(timeStartRace)`
  directly — a naive parse yields Invalid Date → total time of 0. (`timeUtils.ts:74-100`)
- **RULE-TIM-02** — `riderTotalTime` = elapsed from `timeStartRace` → `timeArrive`; if that is not
  computable, fall back to the stored `elapsedTimeFromStart`; if that is empty/zero, return `"—"`.
  (`timeUtils.ts:107-120`)
- **RULE-TIM-03** — `formatTime`: negative or non-finite input → `"00:00"`. Output is `HH:MM:SS`
  when there are whole hours, otherwise `MM:SS`. (`timeUtils.ts:122-136`)

---

## How to use this file for testing

1. Each `RULE-XXX-NN` is one testable assertion — use the ID as the test name.
2. Rules referencing permissions (`MARK_LAP`, `CHECKIN_RIDER`, `MARK_DNF`, `MARK_DNS`) need a
   role/permission fixture — see `docs/cloud/` for the roles model.
3. Known-defect rules (e.g. RULE-POS-04) document *current* behavior; a test may assert the bug
   or be marked pending the fix tracked in `BUGS.md`.
4. When you change a rule in code, update its entry here so the catalog stays the source of truth.
