import { test, expect, Page, Locator } from "@playwright/test";
import { loadDemoRace, selectWave } from "./helpers";

/**
 * Focused coverage for the areas the big end-to-end run doesn't isolate:
 * WAVES, the LEADER BOARD / standings, WINNERS (P1 / medals) and FINISHER TIMES.
 *
 * All ten tests drive the built-in DEMO race, which seeds MID-RACE:
 *   · 2 waves, 8 categories, 40 riders
 *   · Wave 1 live — Elite Men (bibs 1–5, leader on lap 6/7) and Elite Women
 *     (bibs 51–55) are running; Masters 19-29 are checked-in but upcoming
 *   · Wave 2 (bibs 21–35 / 71–105) scheduled, not started
 *
 * Because the demo already carries per-lap history and positions, most of these
 * assertions need no clock manipulation at all.
 */

// Elite Men positions are fixed by the seed's lap data: bib 1 leads (P1), bib 3
// is P2, bib 2 is P3, then bibs 5 and 4. Used by the medal + winner tests.
const ELITE_MEN = { p1: 1, p2: 3, p3: 2, offPodium: 4, all: [1, 2, 3, 4, 5] };
const ELITE_WOMEN_BIBS = [51, 52, 53, 54, 55];
const WAVE2_BIB = 31; // a Masters 50+ rider — scheduled, never on wave 1's board

// ─── Navigation helpers (mirror the ones in full-race-e2e) ───────────────────

/** Setup / Race / Live phase switcher (labelled "Race" / "Start" / "Live"). */
async function gotoPhase(page: Page, phase: "Race" | "Start" | "Live"): Promise<void> {
  await page.getByRole("tab", { name: phase, exact: true }).click();
}

/** Setup-phase tab bar (Schedule / Categories / Riders / Results / …). */
async function openSetupTab(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
}

async function openRaceModeTab(page: Page, name: "Grid" | "Check-In" | "Board"): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
}

function racingCard(page: Page, bib: number): Locator {
  return page.locator(`[data-testid="racing-rider-${bib}"]`);
}

/** A category block on the live Board. */
function boardCategory(page: Page, name: string): Locator {
  return page.locator('[class*="catBlock"]').filter({ hasText: name }).first();
}

/** A category block on the Results tab. */
function resultsCategory(page: Page, name: string): Locator {
  return page.locator('[class*="categoryBlock"]').filter({ hasText: name }).first();
}

/** A category's row on the Schedule tab. */
function scheduleRow(page: Page, name: string): Locator {
  return page.locator('[class*="categoryRow"]').filter({ hasText: name }).first();
}

/** Sign off wave 1 (running in the seed) so results are final. Mirrors race-flow. */
async function finishWave1(page: Page): Promise<void> {
  await gotoPhase(page, "Start");
  await selectWave(page, 1);
  await openRaceModeTab(page, "Grid");
  await page.getByRole("button", { name: /Finish Wave/i }).click();
  await page.getByRole("button", { name: /^Yes/i }).click();
  await expect(page.getByText(/Wave 1 finished/)).toBeVisible();
}

// ─── The tests ───────────────────────────────────────────────────────────────

test.describe("Waves, leaderboard, winners & finisher times", () => {
  test.beforeEach(async ({ page }) => {
    await loadDemoRace(page);
  });

  // 1 ── Waves exist and are split by start time on the Schedule ──────────────
  test("schedule groups the field into two waves", async ({ page }) => {
    await openSetupTab(page, "Schedule");
    // Wave 1 opens at 08:00, wave 2 at 09:00 — both times present proves the
    // split, and both a wave-1 and a wave-2 category are shown.
    await expect(page.getByText("08:00").first()).toBeVisible();
    await expect(page.getByText("09:00").first()).toBeVisible();
    await expect(page.getByText("Elite Men").first()).toBeVisible();
    await expect(page.getByText("50+").first()).toBeVisible();
  });

  // 2 ── Every seeded category shows up on the Schedule ────────────────────────
  test("schedule lists all eight categories", async ({ page }) => {
    await openSetupTab(page, "Schedule");
    await expect(page.locator('[class*="categoryRow"]')).toHaveCount(8);
  });

  // 3 ── Race-mode wave selector offers both waves ────────────────────────────
  test("race mode offers a pill for each wave", async ({ page }) => {
    await gotoPhase(page, "Start");
    await expect(page.locator('button[class*="wavePill"]')).toHaveCount(2);
    // Both are selectable without error.
    await selectWave(page, 1);
    await selectWave(page, 2);
  });

  // 4 ── Live board shows the running categories of the selected wave ─────────
  test("live board shows wave 1's running categories", async ({ page }) => {
    await gotoPhase(page, "Start");
    await selectWave(page, 1);
    await openRaceModeTab(page, "Board");
    await expect(boardCategory(page, "Elite Men")).toBeVisible();
    await expect(boardCategory(page, "Elite Women")).toBeVisible();
  });

  // 5 ── Podium medals mark the top 3 of a category on the live grid ──────────
  test("live grid gives the category top 3 gold / silver / bronze badges", async ({ page }) => {
    await gotoPhase(page, "Start");
    await selectWave(page, 1);
    await gotoPhase(page, "Live");
    await page.waitForURL(/\/heat\/1$/);

    // The leader wears gold, P2 silver, P3 bronze…
    await expect(racingCard(page, ELITE_MEN.p1).locator('[class*="posGold"]')).toBeVisible();
    await expect(racingCard(page, ELITE_MEN.p2).locator('[class*="posSilver"]')).toBeVisible();
    await expect(racingCard(page, ELITE_MEN.p3).locator('[class*="posBronze"]')).toBeVisible();
    // …and a rider off the podium wears no medal chip at all.
    await expect(
      racingCard(page, ELITE_MEN.offPodium).locator('[class*="posMedal"]')
    ).toHaveCount(0);
  });

  // 6 ── Only the started wave's riders are on the live grid ──────────────────
  test("upcoming and other-wave riders are not on the live grid", async ({ page }) => {
    await gotoPhase(page, "Start");
    await selectWave(page, 1);
    await gotoPhase(page, "Live");
    await page.waitForURL(/\/heat\/1$/);

    // The running Elite categories are there…
    await expect(racingCard(page, ELITE_MEN.p1)).toBeVisible();
    await expect(racingCard(page, ELITE_WOMEN_BIBS[0])).toBeVisible();
    // …a wave-1 category that hasn't started (Masters 19-29, bib 11) is not…
    await expect(racingCard(page, 11)).toHaveCount(0);
    // …and neither is a wave-2 rider.
    await expect(racingCard(page, WAVE2_BIB)).toHaveCount(0);
  });

  // 7 ── The leaderboard / standings page opens for a category ────────────────
  test("standings page opens a category leaderboard", async ({ page }) => {
    await openSetupTab(page, "Schedule");
    await scheduleRow(page, "Elite Men").locator('button[class*="standingsBtn"]').click();
    await page.waitForURL(/\/standing\//);

    await expect(page.getByText(/Category: Elite Men/)).toBeVisible();
    // All five Elite Men are on the board, leader included.
    await expect(page.getByText(/Riders \(5\)/)).toBeVisible();
    await expect(page.getByText("Brooks").first()).toBeVisible();
  });

  // 8 ── Results carries a real finisher time once the wave is signed off ─────
  test("results show HH:MM:SS finisher times after the wave finishes", async ({ page }) => {
    await finishWave1(page);
    await gotoPhase(page, "Race");
    await openSetupTab(page, "Results");

    const block = resultsCategory(page, "Elite Men");
    await expect(block).toBeVisible();
    await expect(block).toContainText("Finished");
    // Every Elite Man crossed, so the block carries clock times (BUGS.md #30).
    await expect(block.locator('[class*="time"]').first()).toContainText(/\d{2}:\d{2}:\d{2}/);
  });

  // 9 ── The winner is on top of the board and the results ────────────────────
  test("the category winner reads as P1 on the board and first in results", async ({ page }) => {
    await finishWave1(page);

    // On the board the finished category reports a P1.
    await gotoPhase(page, "Start");
    await selectWave(page, 1);
    await openRaceModeTab(page, "Board");
    await expect(boardCategory(page, "Elite Men").getByText("P1")).toBeVisible();

    // In the results the leader (bib 1, Brooks) sits in the category block.
    await gotoPhase(page, "Race");
    await openSetupTab(page, "Results");
    const block = resultsCategory(page, "Elite Men");
    await expect(block).toContainText("Brooks");
    await expect(block.locator('[class*="row"]').first()).toContainText("Brooks");
  });

  // 10 ── The Results wave filter separates the two waves ─────────────────────
  test("results wave filter separates wave 1 from wave 2", async ({ page }) => {
    await openSetupTab(page, "Results");

    // Narrow to wave 2 — Elite Men (wave 1) drops out, a Masters 50+ block stays.
    // (Match the visible category block, not the hidden filter <option>.)
    await page.getByRole("button", { name: "Wave 2", exact: true }).click();
    await expect(resultsCategory(page, "Elite Men")).toHaveCount(0);
    await expect(resultsCategory(page, "50+")).toBeVisible();

    // Back to wave 1 — Elite Men returns.
    await page.getByRole("button", { name: "Wave 1", exact: true }).click();
    await expect(resultsCategory(page, "Elite Men")).toBeVisible();
  });
});
