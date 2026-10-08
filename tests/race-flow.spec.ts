import { test, expect } from "@playwright/test";
import { loadDemoRace, selectWave } from "./helpers";

/**
 * End-to-end smoke of the core Commissaire flow:
 *   load demo race (adds riders) → verify riders → verify schedule/waves
 *   → enter Race mode → check-in riders → start a wave → finish → results.
 *
 * Each Playwright test gets a fresh browser context (empty IndexedDB), so the
 * app always starts with no local races and offers the "Try Demo Race" button.
 */

const EXPECTED_RIDERS = 40;

test.describe("Commissaire race flow", () => {
  test("add riders, schedule, start & finish a wave, see results", async ({ page }) => {
    // ── 1. Load demo race (adds 40 riders across 8 categories / 2 waves) ──────
    await test.step("load demo race", async () => {
      await loadDemoRace(page);
      await expect(page.getByRole("button", { name: "Riders", exact: true })).toBeVisible();
    });

    // ── 2. Riders tab: verify riders were added ──────────────────────────────
    await test.step("verify riders added", async () => {
      await page.getByRole("button", { name: "Riders", exact: true }).click();
      await expect(page.getByText(`Riders (${EXPECTED_RIDERS})`)).toBeVisible();
    });

    // ── 3. Actions dropdown → Edit Riders enters and exits edit mode ──────────
    await test.step("Actions → Edit Riders enters and exits edit mode", async () => {
      // Edit now lives inside the "Actions" dropdown (with Import CSV / Scan).
      await page.getByRole("button", { name: "Actions" }).click();
      await page.getByRole("menuitem", { name: /Edit Riders/i }).click();
      // EditRiders toolbar shows the "← Back" button (distinct from the
      // header's "Back to main") + the search placeholder.
      const backBtn = page.getByRole("button", { name: /← Back/ });
      await expect(backBtn).toBeVisible();
      await expect(page.getByPlaceholder(/Name or bib/i)).toBeVisible();
      await backBtn.click();
      // Back to the normal riders list
      await expect(page.getByText(`Riders (${EXPECTED_RIDERS})`)).toBeVisible();
    });

    // ── 4. Schedule tab: verify waves exist ──────────────────────────────────
    await test.step("verify schedule / waves", async () => {
      await page.getByRole("button", { name: "Schedule", exact: true }).click();
      // Demo has 2 waves; schedule should reference Wave text.
      await expect(page.getByText(/Wave/i).first()).toBeVisible();
    });

    // ── 5. Enter Race mode ───────────────────────────────────────────────────
    await test.step("enter Race mode", async () => {
      // Phase switcher: "Race" = setup, "Start" = race mode, "Live" = live.
      await page.getByRole("tab", { name: "Start", exact: true }).click();
      // Sub-tab bar of race mode
      await expect(page.getByRole("button", { name: "Grid", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Check-In", exact: true })).toBeVisible();
    });

    // ── 5b. Close out wave 1 ─────────────────────────────────────────────────
    // The demo seeds MID-RACE with wave 1 already checked in and on course, and
    // the app allows only one wave running at a time — so wave 1 has to be
    // signed off before wave 2 can take the line.
    await test.step("finish the wave already on course", async () => {
      await selectWave(page, 1);
      await page.getByRole("button", { name: "Grid", exact: true }).click();
      await page.getByRole("button", { name: /Finish Wave/i }).click();
      await page.getByRole("button", { name: /^Yes/i }).click();
      await expect(page.getByText(/Wave 1 finished/)).toBeVisible();
      await selectWave(page, 2);
    });

    // ── 6. Check-in all riders in the selected wave ──────────────────────────
    await test.step("check in wave riders", async () => {
      await page.getByRole("button", { name: "Check-In", exact: true }).click();
      const checkAll = page.getByRole("button", { name: /Check All/i });
      await expect(checkAll).toBeVisible();
      await checkAll.click();
      // Once everyone is accounted for, the Check All button disappears.
      await expect(checkAll).toHaveCount(0);
    });

    // ── 7. Start the first start group ───────────────────────────────────────
    await test.step("start a wave", async () => {
      await page.getByRole("button", { name: "Grid", exact: true }).click();
      const startBtn = page.getByRole("button", { name: /Start All/i }).first();
      await expect(startBtn).toBeVisible();
      await startBtn.click();
      // A started group flips to the RUNNING state.
      await expect(page.getByText(/RUNNING/).first()).toBeVisible();
    });

    // ── 8. Finish the running group ──────────────────────────────────────────
    await test.step("finish the running group", async () => {
      await page.getByRole("button", { name: /Finish/i }).first().click();
      await page.getByRole("button", { name: /^Yes/i }).click();
      await expect(page.getByText(/FINISHED/).first()).toBeVisible();
    });

    // ── 9. Results tab renders ───────────────────────────────────────────────
    await test.step("view results", async () => {
      // Return to setup (the "Race" phase) to reach the Results tab.
      await page.getByRole("tab", { name: "Race", exact: true }).click();
      await page.getByRole("button", { name: "Results", exact: true }).click();
      // Results tab mounts without crashing (page still shows the tab bar).
      await expect(page.getByRole("button", { name: "Results", exact: true })).toBeVisible();
    });
  });
});
