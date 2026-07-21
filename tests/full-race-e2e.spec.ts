import { test, expect, Page, Locator } from "@playwright/test";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import * as XLSX from "xlsx";
import { acceptTerms, selectWave } from "./helpers";

/**
 * Full end-to-end run of a real race day, start to finish.
 *
 * See TEST.md for the scenario in prose (and for the knobs you can turn).
 *
 * The whole run is driven on a FAKE CLOCK (`page.clock`). Two things in the app
 * make that mandatory rather than a nicety:
 *   · the live lap screen refuses a second lap within 60 s (`MIN_LAP_MS`), so a
 *     realistic 5-minute lap can't be faked by clicking fast;
 *   · a rider card waits 300 ms after a tap to tell a single tap from a double
 *     tap, so a tap only counts once the clock is nudged past that.
 * With the clock frozen, nothing "drifts" between steps — the test is
 * deterministic and a 40-minute race runs in seconds.
 */

// ─── Scenario knobs ──────────────────────────────────────────────────────────
// Change these and the test still works; TEST.md explains what each one drives.

const CSV_FIXTURE = path.resolve(__dirname, "fixtures", "full-race.csv");
const RACE_NAME = "E2E Full Race";
/** Simulated time on course per lap. */
const LAP_MINUTES = 5;
/** Race-day clock the fake timer starts at (before the first start). */
const RACE_DAY_START = new Date("2026-07-21T07:45:00");

type CategoryPlan = {
  name: string;
  /** Start time from the CSV — also the identity of its start group on the Grid. */
  startTime: string;
  laps: number;
  bibs: number[];
};

type WavePlan = {
  wave: number;
  categories: CategoryPlan[];
  /** Marked DNS at check-in — never starts, never appears on Live. */
  dnsBib: number;
  /** Marked DNF on the live screen after lap 1. */
  dnfBib: number;
  /** Marked DSQ on the live screen after lap 2. */
  dsqBib: number;
  /** Riders that get a commissaire note. */
  commentBibs: number[];
  /**
   * Start group flagged off early, before its riders have run their full
   * distance — the remaining riders must show as "still on track" and finish on
   * their next crossing.
   */
  earlyFinishCategory: string;
  earlyFinishAfterLap: number;
};

const WAVE_1: WavePlan = {
  wave: 1,
  categories: [
    { name: "Elite Men", startTime: "08:00", laps: 2, bibs: [1, 2, 3, 4, 5] },
    { name: "Elite Women", startTime: "08:10", laps: 3, bibs: [11, 12, 13, 14, 15] },
    { name: "Junior Men", startTime: "08:20", laps: 4, bibs: [21, 22, 23, 24, 25] },
  ],
  dnsBib: 5,
  dnfBib: 15,
  dsqBib: 25,
  commentBibs: [1, 22],
  earlyFinishCategory: "Junior Men",
  earlyFinishAfterLap: 3,
};

const WAVE_2: WavePlan = {
  wave: 2,
  categories: [
    { name: "Masters Men 30-39", startTime: "09:00", laps: 3, bibs: [31, 32, 33, 34, 35] },
    { name: "Masters Women 30-39", startTime: "09:10", laps: 4, bibs: [41, 42, 43, 44, 45] },
    { name: "Masters Men 50+", startTime: "09:20", laps: 5, bibs: [51, 52, 53, 54, 55] },
  ],
  dnsBib: 35,
  dnfBib: 45,
  dsqBib: 55,
  commentBibs: [31, 52],
  earlyFinishCategory: "Masters Men 50+",
  earlyFinishAfterLap: 4,
};

/** Two riders that turn up on the day and have to be entered by hand. */
const LATE_ENTRIES = [
  { bib: 6, firstName: "Walk", lastName: "Uponee", category: "Elite Men", team: "Summit Velo" },
  { bib: 7, firstName: "Late", lastName: "Entryman", category: "Elite Men", team: "Iron Peak Cycling" },
];

const CSV_RIDERS = 30;
const TOTAL_RIDERS = CSV_RIDERS + LATE_ENTRIES.length;

// ─── Clock helpers ───────────────────────────────────────────────────────────

/** Nudge the fake clock just past the 300 ms single/double tap window. */
const TAP_SETTLE_MS = 400;

async function advanceLap(page: Page): Promise<void> {
  await page.clock.fastForward(LAP_MINUTES * 60 * 1000);
}

// ─── Navigation helpers ──────────────────────────────────────────────────────

/** Setup / Race / Live phase switcher (labelled "Race" / "Start" / "Live"). */
async function gotoPhase(page: Page, phase: "Race" | "Start" | "Live"): Promise<void> {
  await page.getByRole("tab", { name: phase, exact: true }).click();
}

/** Setup-phase tab bar (Schedule / Categories / Riders / Results / Map / Info). */
async function openSetupTab(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
}

async function openRaceModeTab(page: Page, name: "Grid" | "Check-In" | "Board"): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
}

/**
 * The start block for one start group, keyed by its start time. Not by category
 * name: once a group is finished its block collapses and the category names are
 * hidden behind an expander, but the time stays on the header throughout.
 */
function startBlockFor(page: Page, startTime: string): Locator {
  return page.locator('[class*="startBlock"]').filter({ hasText: startTime }).first();
}

/** A rider's row on the Results tab. */
function resultsRow(page: Page, bib: number): Locator {
  return page.locator('[class*="row"]').filter({ hasText: `#${bib}` }).first();
}

/** A category's row on the Schedule tab ("N riders · N laps" + the trophy button). */
function scheduleCategoryRow(page: Page, categoryName: string): Locator {
  return page.locator('[class*="categoryRow"]').filter({ hasText: categoryName }).first();
}

// ─── Rider helpers ───────────────────────────────────────────────────────────

function racingCard(page: Page, bib: number): Locator {
  return page.locator(`[data-testid="racing-rider-${bib}"]`);
}

function finishedCard(page: Page, bib: number): Locator {
  return page.locator(`[data-testid="finish-rider-${bib}"]`);
}

/** Record one lap for a rider, then let the fake clock settle the tap. */
async function tapRider(page: Page, bib: number): Promise<void> {
  await racingCard(page, bib).click();
  await page.clock.fastForward(TAP_SETTLE_MS);
}

/** Bibs currently on the racing grid, in display order. */
async function racingBibs(page: Page): Promise<number[]> {
  const ids = await page.locator('[data-testid^="racing-rider-"]').evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset.testid ?? "")
  );
  return ids.map((id) => Number(id.replace("racing-rider-", ""))).filter((n) => !Number.isNaN(n));
}

/** Open a rider's live modal (double tap on their card). */
async function openRiderModal(page: Page, bib: number, finished = false): Promise<void> {
  const card = finished ? finishedCard(page, bib) : racingCard(page, bib);
  await card.dblclick();
  await expect(page.getByText("Note / Comment")).toBeVisible();
}

async function closeRiderModal(page: Page): Promise<void> {
  // Scoped to the modal's own close button — the live screen has other ✕ controls.
  await page.locator('[class*="closeBtn"]').first().click();
  await expect(page.getByText("Note / Comment")).toHaveCount(0);
}

async function markLiveStatus(page: Page, bib: number, status: "DNF" | "DSQ"): Promise<void> {
  await openRiderModal(page, bib);
  await page.getByRole("button", { name: status, exact: true }).click();
  // The modal closes itself and the rider drops out of the racing grid.
  await expect(racingCard(page, bib)).toHaveCount(0);
  await expect(finishedCard(page, bib)).toHaveAttribute("data-status", status);
}

async function addRiderNote(page: Page, bib: number, note: string): Promise<void> {
  // The rider may have finished by now, so try the racing grid then the finishers.
  const stillRacing = (await racingCard(page, bib).count()) > 0;
  await openRiderModal(page, bib, !stillRacing);
  await page.locator("textarea").fill(note);
  await page.getByRole("button", { name: /Save Note/ }).click();
  await expect(page.getByRole("button", { name: /Saved/ })).toBeVisible();
  await closeRiderModal(page);
}

// ─── The test ────────────────────────────────────────────────────────────────

test.describe("Full race day", () => {
  // A whole race day is a long walk: two waves, six categories, ~130 taps.
  test.setTimeout(15 * 60 * 1000);

  test("build a race, run both waves, and export a signed result file", async ({ page }, testInfo) => {
    // Everything from here on runs on the fake clock.
    await page.clock.install({ time: RACE_DAY_START });

    let raceUrl = "";

    // ── 1. Create the race and upload the start list ────────────────────────
    await test.step("accept the terms gate", async () => {
      await page.goto("/main");
      // First load of a fresh profile is gated behind the T&C dialog.
      await expect(page.getByRole("dialog", { name: /Terms and Conditions/i })).toBeVisible();
      await acceptTerms(page);
    });

    await test.step("create race with an uploaded start list", async () => {
      // A fresh profile has no races, so the empty state offers the entry point.
      await page.getByRole("button", { name: /Create new race/ }).click();

      await expect(page.getByText("Add Race", { exact: true })).toBeVisible();
      await page.getByPlaceholder("Race Name").fill(RACE_NAME);
      await page.getByPlaceholder("Location").fill("E2E Test Circuit");
      await page.locator("#ridersFileUpload").setInputFiles(CSV_FIXTURE);
      await page.getByRole("button", { name: /Done|Saving/ }).click();

      // Back on the races list, with the new race on it.
      await expect(page.getByText(RACE_NAME).first()).toBeVisible();
      await page.getByText(RACE_NAME).first().click();
      await page.waitForURL(/\/race\/[^/]+$/);
      raceUrl = page.url();
    });

    // ── 2. The upload produced 30 riders in 6 categories across 2 waves ──────
    await test.step("start list imported: 30 riders, 6 categories, 2 waves", async () => {
      await openSetupTab(page, "Riders");
      await expect(page.getByText(`Riders (${CSV_RIDERS})`)).toBeVisible();

      await openSetupTab(page, "Categories");
      for (const cat of [...WAVE_1.categories, ...WAVE_2.categories]) {
        await expect(
          page.getByRole("button", { name: `Show riders in ${cat.name}` })
        ).toBeVisible();
      }

      await openSetupTab(page, "Schedule");
      // Categories were auto-derived from the start list, so each one's lap count
      // and wave came across with it — and no two categories share a lap count
      // within a wave.
      for (const wave of [WAVE_1, WAVE_2]) {
        for (const cat of wave.categories) {
          const row = scheduleCategoryRow(page, cat.name);
          await expect(row).toBeVisible();
          await expect(row).toContainText(`${cat.bibs.length} riders`);
          await expect(row).toContainText(`${cat.laps} laps`);
        }
      }
    });

    // ── 3–8. Run wave 1, then wave 2 ────────────────────────────────────────
    await runWave(page, WAVE_1, { lateEntries: LATE_ENTRIES });
    await runWave(page, WAVE_2, { lateEntries: [] });

    // ── 9. Boards read as expected once everything is done ──────────────────
    await test.step("final boards show every category finished", async () => {
      await gotoPhase(page, "Start");
      for (const wave of [WAVE_1, WAVE_2]) {
        await selectWave(page, wave.wave);
        await openRaceModeTab(page, "Board");
        for (const cat of wave.categories) {
          const block = page.locator('[class*="catBlock"]').filter({ hasText: cat.name }).first();
          await expect(block).toBeVisible();
          // A finished category reports its finisher count as "N fin".
          await expect(block.getByText(/\d+ fin/)).toBeVisible();
        }
      }
    });

    await test.step("results tab lists the finished field", async () => {
      await gotoPhase(page, "Race");
      await openSetupTab(page, "Results");
      // One results block per category, each reporting Finished.
      for (const wave of [WAVE_1, WAVE_2]) {
        for (const cat of wave.categories) {
          const block = page
            .locator('[class*="categoryBlock"]')
            .filter({ hasText: cat.name })
            .first();
          await expect(block).toBeVisible();
          await expect(block).toContainText("Finished");
        }
      }

      // Out-statuses are classified rather than ranked.
      for (const wave of [WAVE_1, WAVE_2]) {
        await expect(page.getByText(`#${wave.dnsBib}`).first()).toBeVisible();
        for (const [bib, status] of [
          [wave.dnfBib, "DNF"],
          [wave.dsqBib, "DSQ"],
        ] as const) {
          const row = page.locator('[class*="riderRow"], [class*="row"]')
            .filter({ hasText: `#${bib}` })
            .first();
          await expect(row).toContainText(status);
        }
      }

      // The riders added by hand on the day are in the results like anyone else.
      for (const entry of LATE_ENTRIES) {
        await expect(page.getByText(entry.lastName).first()).toBeVisible();
      }

      // Column chooser (BUGS.md #8): hiding a column takes effect, the name is
      // never hidden, and the choice survives a reload via localStorage.
      const sampleBib = WAVE_1.categories[0].bibs[0];
      const sampleName = "Brooks";
      await expect(page.getByText(`#${sampleBib}`).first()).toBeVisible();

      // The menu keeps an overlay open after a toggle, so close it each time.
      const toggleColumn = async (label: string) => {
        await page.getByRole("button", { name: /Columns/ }).click();
        await page.getByRole("menu").getByText(label, { exact: true }).click();
        await page.locator('[class*="fieldMenuOverlay"]').click();
        await expect(page.getByRole("menu")).toHaveCount(0);
      };

      await toggleColumn("Bib #");
      await expect(page.getByText(`#${sampleBib}`)).toHaveCount(0);
      await expect(page.getByText(sampleName).first()).toBeVisible();

      // Persisted as the default for next time (localStorage, not just state).
      const saved = await page.evaluate(() =>
        localStorage.getItem("resultsVisibleFields")
      );
      expect(saved).not.toBeNull();
      expect(JSON.parse(saved!)).not.toContain("bib");

      // Put it back so the later export assertions see a normal Results tab.
      await toggleColumn("Bib #");
      await expect(page.getByText(`#${sampleBib}`).first()).toBeVisible();

      // Every finisher has a real elapsed time (BUGS.md #30 — these all used to
      // render "—" because timeStartRace was parsed with new Date()).
      for (const wave of [WAVE_1, WAVE_2]) {
        for (const cat of wave.categories) {
          const finisherBibs = cat.bibs.filter(
            (b) => b !== wave.dnsBib && b !== wave.dnfBib && b !== wave.dsqBib
          );
          for (const bib of finisherBibs) {
            const row = resultsRow(page, bib);
            await expect(row).toContainText(/\d{2}:\d{2}:\d{2}/);
          }
        }
      }
      // …and riders who never finished still show no time.
      for (const wave of [WAVE_1, WAVE_2]) {
        for (const bib of [wave.dnsBib, wave.dnfBib, wave.dsqBib]) {
          await expect(resultsRow(page, bib)).not.toContainText(/\d{2}:\d{2}:\d{2}/);
        }
      }
    });

    // ── 10. Export the whole race, signed for the logged-in user ────────────
    await test.step("export the full race file and verify its crypto token", async () => {
      await openSetupTab(page, "Info");
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: /Export to Excel/ }).click();
      // The button and the modal title share their label (see finding U4), so
      // reach for the heading specifically.
      await expect(page.getByRole("heading", { name: "Export to Excel" })).toBeVisible();
      await page.getByRole("button", { name: /^Export All$/ }).click();

      const download = await downloadPromise;
      const filePath = path.join(testInfo.outputDir, download.suggestedFilename());
      await download.saveAs(filePath);
      expect(fs.existsSync(filePath)).toBe(true);

      const wb = XLSX.read(fs.readFileSync(filePath));
      expect(wb.SheetNames).toContain("Signature");
      expect(wb.SheetNames).toContain("Riders");

      const sig = sheetToFieldMap(wb, "Signature");
      expect(sig.algo).toBe("SHA-256");
      expect(sig.version).toBe("commissaire-race-export/v1");
      // No one is signed in during the test, so the file is stamped anonymous —
      // the point is that the field is there and is part of the hashed payload.
      expect(sig.exportedBy).toBe("anonymous");
      expect(sig.nonce).toMatch(/^[0-9a-f]{32}$/);
      expect(sig.token).toMatch(/^[0-9a-f]{64}$/);

      // The token is genuinely a SHA-256 of the recorded payload.
      const recomputed = crypto.createHash("sha256").update(sig.payload, "utf8").digest("hex");
      expect(recomputed).toBe(sig.token);

      // …and the payload really commits to the rider results in this file, so an
      // edited placing would not verify.
      const riderRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Riders"], {
        defval: "",
      });
      expect(riderRows.length).toBe(TOTAL_RIDERS);
      const digest = riderRows
        .map((r) => ({
          id: Number(r.id),
          line: [
            r.id,
            r.bibNumber,
            r.lapsCounter === "" ? 0 : r.lapsCounter,
            r.status,
            r.raceStatus,
            r.position_category === "" ? 0 : r.position_category,
            r.elapsedTimeFromStart,
          ].join(":"),
        }))
        .sort((a, b) => a.id - b.id)
        .map((r) => r.line)
        .join(";");
      expect(sig.payload).toContain(`data=${digest}`);
      expect(sig.payload).toContain(`riders=${TOTAL_RIDERS}`);

      // Tampering breaks it: flip one character of the payload and the hash moves.
      const tampered = crypto
        .createHash("sha256")
        .update(sig.payload.replace("data=", "data=X"), "utf8")
        .digest("hex");
      expect(tampered).not.toBe(sig.token);

      // ── In-app verification (BUGS.md #28) ────────────────────────────────
      const verifyInput = page.locator('input[type="file"][accept*="xls"]').last();
      const verdict = page.getByTestId("verify-result");

      // 1. The untouched file verifies.
      await verifyInput.setInputFiles(filePath);
      await expect(verdict).toHaveAttribute("data-status", "valid");
      await expect(verdict).toContainText("Signature valid");
      await expect(verdict).toContainText("anonymous");

      // 2. Change one lap value → results-modified.
      const lapEdited = path.join(testInfo.outputDir, "lap-edited.xlsx");
      writeEditedWorkbook(filePath, lapEdited, (row) => {
        row.lapsCounter = String(Number(row.lapsCounter) + 1);
      });
      await verifyInput.setInputFiles(lapEdited);
      await expect(verdict).toHaveAttribute("data-status", "results-modified");
      await expect(verdict).toContainText("have been changed");

      // 3. Change one position → results-modified.
      const posEdited = path.join(testInfo.outputDir, "pos-edited.xlsx");
      writeEditedWorkbook(filePath, posEdited, (row) => {
        row.position_category = String(Number(row.position_category || 0) + 5);
      });
      await verifyInput.setInputFiles(posEdited);
      await expect(verdict).toHaveAttribute("data-status", "results-modified");

      // 4. A workbook with no Signature sheet → unsigned, with a clear message.
      const unsigned = path.join(testInfo.outputDir, "unsigned.xlsx");
      const stripped = XLSX.read(fs.readFileSync(filePath));
      stripped.SheetNames = stripped.SheetNames.filter((n) => n !== "Signature");
      delete stripped.Sheets["Signature"];
      XLSX.writeFile(stripped, unsigned);
      await verifyInput.setInputFiles(unsigned);
      await expect(verdict).toHaveAttribute("data-status", "unsigned");
      await expect(verdict).toContainText("no signature sheet");
    });

    expect(raceUrl).toMatch(/\/race\//);
  });
});

// ─── Wave runner ─────────────────────────────────────────────────────────────

async function runWave(
  page: Page,
  plan: WavePlan,
  opts: { lateEntries: typeof LATE_ENTRIES }
): Promise<void> {
  const label = `wave ${plan.wave}`;
  /** Riders hand-added into this wave on the day. */
  const extraRiders = opts.lateEntries.length;
  const maxLaps = Math.max(...plan.categories.map((c) => c.laps));

  await test.step(`${label}: check in, mark DNS, add late entries`, async () => {
    await gotoPhase(page, "Start");
    await selectWave(page, plan.wave);
    await openRaceModeTab(page, "Check-In");

    const checkAll = page.getByRole("button", { name: /Check All/ });
    await expect(checkAll).toBeVisible();
    await checkAll.click();
    await expect(checkAll).toHaveCount(0);

    // One rider signs off before the start — DNS, so they never take the line.
    // Uses the one-tap row action (BUGS.md #25) rather than the Status menu.
    await page.getByRole("button", { name: `Mark #${plan.dnsBib} DNS` }).click();
    await expect(page.getByText(/✗ 1 DNS/)).toBeVisible();

    // Both controls drive the same field. Once out, the row collapses to an
    // inline DNS badge; tapping it opens the Status menu, and clearing there
    // clears the row too.
    const dnsRow = checkInRow(page, plan.dnsBib);
    await expect(dnsRow.getByRole("button", { name: "DNS" })).toBeVisible();
    await dnsRow.getByRole("button", { name: "DNS" }).click();
    await page.locator('[class*="modalbottom"]').first().getByText("STANDING", { exact: true }).click();
    await expect(page.getByText(/✗ 0 DNS/)).toBeVisible();

    // Put them back out — this time through the Status menu, to prove both paths.
    await setStatusAtCheckIn(page, plan.dnsBib, "DNS");
    await expect(page.getByText(/✗ 1 DNS/)).toBeVisible();

    for (const entry of opts.lateEntries) {
      await page.getByRole("button", { name: /Quick Add Rider/ }).click();
      await page.getByPlaceholder("First name *").fill(entry.firstName);
      await page.getByPlaceholder("Last name *").fill(entry.lastName);
      await page.getByPlaceholder("Bib # *").fill(String(entry.bib));
      await page.getByPlaceholder("Club / team").fill(entry.team);
      await page.locator("select").last().selectOption(entry.category);
      await page.getByRole("button", { name: "Add Rider", exact: true }).click();
      await expect(page.getByText(`#${entry.bib}`)).toBeVisible();
    }
  });

  await test.step(`${label}: start every start group`, async () => {
    await openRaceModeTab(page, "Grid");
    for (const cat of plan.categories) {
      const block = startBlockFor(page, cat.startTime);
      await block.getByTestId("start-all").click();
      await expect(block.getByText(/RUNNING/)).toBeVisible();
      // Stagger the starts the way a real grid does.
      await page.clock.fastForward(60 * 1000);
    }
  });

  await test.step(`${label}: record laps live`, async () => {
    await gotoPhase(page, "Live");
    await page.waitForURL(new RegExp(`/heat/${plan.wave}$`));

    // The DNS rider never started, so they must not be on the live board at all.
    await expect(racingCard(page, plan.dnsBib)).toHaveCount(0);

    for (let lap = 1; lap <= maxLaps; lap++) {
      await advanceLap(page);

      for (const bib of await racingBibs(page)) {
        await tapRider(page, bib);
      }

      if (lap === 1) await markLiveStatus(page, plan.dnfBib, "DNF");
      if (lap === 2) await markLiveStatus(page, plan.dsqBib, "DSQ");

      if (lap === plan.earlyFinishAfterLap) {
        await flagOffEarly(page, plan);
      }
    }
  });

  await test.step(`${label}: add commissaire notes`, async () => {
    for (const bib of plan.commentBibs) {
      await addRiderNote(page, bib, `${label} note for #${bib}`);
    }
  });

  await test.step(`${label}: winners are on the board`, async () => {
    await gotoPhase(page, "Start");
    await selectWave(page, plan.wave);
    await openRaceModeTab(page, "Board");
    for (const cat of plan.categories) {
      const block = page.locator('[class*="catBlock"]').filter({ hasText: cat.name }).first();
      await expect(block).toBeVisible();
      // Somebody won it.
      await expect(block.getByText("P1")).toBeVisible();
    }
  });

  await test.step(`${label}: all-riders status view`, async () => {
    // Every rider in the wave appears exactly once, with a real status
    // (BUGS.md #24). Staggered start groups, so this is the only single view
    // that accounts for the whole field.
    await gotoPhase(page, "Start");
    await selectWave(page, plan.wave);
    await page.getByRole("button", { name: "All Riders", exact: true }).click();
    await expect(page.getByTestId("wave-status")).toBeVisible();

    const expected = plan.categories.flatMap((c) => c.bibs).length + extraRiders;
    const rows = page.locator('[data-testid^="wave-status-row-"]');
    await expect(rows).toHaveCount(expected);

    // No duplicates.
    const ids = await rows.evaluateAll((els) =>
      els.map((e) => (e as HTMLElement).dataset.testid ?? "")
    );
    expect(new Set(ids).size).toBe(ids.length);

    // The out-riders are classified, not lumped in with finishers.
    for (const [bib, status] of [
      [plan.dnsBib, "DNS"],
      [plan.dnfBib, "DNF"],
      [plan.dsqBib, "DSQ"],
    ] as const) {
      await expect(page.getByTestId(`wave-status-row-${bib}`)).toHaveAttribute(
        "data-bucket",
        status
      );
    }

    // Filtering narrows without losing anyone.
    await page.getByRole("button", { name: /^DNF/ }).click();
    await expect(page.locator('[data-testid^="wave-status-row-"]')).toHaveCount(1);
    await page.getByTestId("wave-status-filter-all").click();
    await expect(page.locator('[data-testid^="wave-status-row-"]')).toHaveCount(expected);
  });

  await test.step(`${label}: standings page per category`, async () => {
    await gotoPhase(page, "Race");
    await openSetupTab(page, "Schedule");
    const cat = plan.categories[0];
    await scheduleCategoryRow(page, cat.name).locator('button[class*="standingsBtn"]').click();
    await page.waitForURL(/\/standing\//);
    await expect(page.getByText(`Category: ${cat.name}`)).toBeVisible();
    // Note: wave 1's first category also holds the hand-added late entries, so
    // read the count rather than assuming it equals the CSV field size.
    const shownCount = async (): Promise<number> => {
      const text = await page.getByText(/Riders \(\d+\)/).first().innerText();
      return Number(/\((\d+)\)/.exec(text)![1]);
    };
    const firstCount = await shownCount();
    expect(firstCount).toBeGreaterThanOrEqual(cat.bibs.length);

    // The category filter actually filters (BUGS.md #22 — it used to discard the
    // selection and close). "All" widens to the whole race, then narrow again.
    // Options are scoped to the modal: rider rows show category names too.
    const pickCategory = async (name: string) => {
      await page.locator('img[alt="filter"]').click();
      const modal = page.locator('[class*="modalbottom"]').first();
      await expect(modal).toBeVisible();
      await modal.getByText(name, { exact: true }).click();
    };

    await pickCategory("All");
    await expect(page.getByText("Category: All")).toBeVisible();
    expect(await shownCount()).toBeGreaterThan(firstCount);

    // Narrowing to a different category shows exactly that category.
    const other = plan.categories[1];
    await pickCategory(other.name);
    await expect(page.getByText(`Category: ${other.name}`)).toBeVisible();
    expect(await shownCount()).toBe(other.bibs.length);

    await page.goBack();
    await page.waitForURL(/\/race\/[^/]+$/);
  });

  await test.step(`${label}: finish the wave`, async () => {
    await gotoPhase(page, "Start");
    await selectWave(page, plan.wave);
    await openRaceModeTab(page, "Grid");
    const finishWave = page.getByTestId("finish-wave");
    if (await finishWave.count()) {
      await finishWave.click();
      await page.getByTestId("confirm-yes-wave").click();
    }
    await expect(page.getByText(`Wave ${plan.wave} finished`)).toBeVisible();
  });
}

/**
 * Flag off a start group before its riders have completed their distance. The
 * riders still out there must stay visible, marked "on track", and finish on
 * their next crossing rather than vanishing.
 */
async function flagOffEarly(page: Page, plan: WavePlan): Promise<void> {
  const catName = plan.earlyFinishCategory;
  const cat = plan.categories.find((c) => c.name === catName)!;
  const stillOut = (await racingBibs(page)).filter((b) => cat.bibs.includes(b));
  expect(stillOut.length).toBeGreaterThan(0);

  await gotoPhase(page, "Start");
  await selectWave(page, plan.wave);
  await openRaceModeTab(page, "Grid");
  const block = startBlockFor(page, cat.startTime);
  await block.getByTestId("finish-start-group").click();
  // The confirmation spells out what happens to riders still out (BUGS.md #23).
  await expect(block).toContainText(
    `${stillOut.length} rider${stillOut.length > 1 ? "s" : ""} still on course`
  );
  await expect(block).toContainText("ON TRACK");
  await expect(block).toContainText("finish on their next crossing");
  await block.getByTestId("confirm-yes").click();
  await expect(block.getByText(/FINISHED/)).toBeVisible();

  await gotoPhase(page, "Live");
  await page.waitForURL(new RegExp(`/heat/${plan.wave}$`));

  // The point of flagging off early (BUGS.md #31): riders still out on course
  // must NOT vanish and must NOT be recorded as finishers. They stay on the
  // racing grid, ribboned, and the header counts them.
  for (const bib of stillOut) {
    const card = racingCard(page, bib);
    await expect(card).toBeVisible();
    await expect(card).toContainText("ON TRACK");
  }
  await expect(page.getByText(`⚑ ${stillOut.length} still on track`)).toBeVisible();

  // …and they finish on their NEXT crossing, regardless of laps remaining.
  const oneMore = stillOut[0];
  await page.clock.fastForward(LAP_MINUTES * 60 * 1000);
  await tapRider(page, oneMore);
  await expect(racingCard(page, oneMore)).toHaveCount(0);
  await expect(finishedCard(page, oneMore)).toHaveAttribute("data-status", "FIN");
}

/** A rider's row on the Check-In list. */
function checkInRow(page: Page, bib: number): Locator {
  return page.getByTestId(`checkin-row-${bib}`);
}

/** Change a rider's status via the check-in row's Status menu. */
async function setStatusAtCheckIn(
  page: Page,
  bib: number,
  status: "DNS" | "DNF" | "DSQ"
): Promise<void> {
  const row = checkInRow(page, bib);
  await row.getByRole("button", { name: "Status" }).click();
  // Scoped to the modal — the row itself now carries a one-tap DNS button, so
  // a bare getByText("DNS") is ambiguous.
  const modal = page.locator('[class*="modalbottom"]').first();
  await expect(modal).toBeVisible();
  await modal.getByText(status, { exact: true }).click();
  await expect(row.getByRole("button", { name: status })).toBeVisible();
}

/**
 * Copy an exported workbook, mutate the FIRST rider row, and write it back —
 * the "someone edited the results after export" case.
 */
function writeEditedWorkbook(
  src: string,
  dest: string,
  edit: (row: Record<string, string>) => void
): void {
  const wb = XLSX.read(fs.readFileSync(src));
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets["Riders"], {
    defval: "",
    raw: false,
  });
  edit(rows[0]);
  wb.Sheets["Riders"] = XLSX.utils.json_to_sheet(rows);
  XLSX.writeFile(wb, dest);
}

/** Read a two-column "Field / Value" sheet into a plain object. */
function sheetToFieldMap(wb: XLSX.WorkBook, sheet: string): Record<string, string> {
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheet], { header: 1, defval: "" });
  const out: Record<string, string> = {};
  for (const [key, value] of rows.slice(1)) {
    if (key) out[String(key)] = String(value ?? "");
  }
  return out;
}
