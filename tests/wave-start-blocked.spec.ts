import { test, expect } from "@playwright/test";
import { gotoRaceMode, loadDemoRace, openRaceView } from "./helpers";

/**
 * Only one wave races at a time. Starting Wave 2 while Wave 1 is on course must
 * explain itself (which wave, what to do) — from the Race page card and from the
 * Start screen — instead of silently doing nothing. Demo race: Wave 1 is racing.
 */
test.describe("Starting a wave while an earlier one is in progress", () => {
  test("Race card Start and the Start screen both explain it and offer the way out", async ({ page }) => {
    await loadDemoRace(page);
    await gotoRaceMode(page, "Race");
    const backdrop = page.getByTestId("sheet-backdrop");
    if (await backdrop.isVisible().catch(() => false)) await backdrop.click({ position: { x: 5, y: 5 } });

    // Wave 2 sheet → Check-In all, then the Start screen inside the same sheet.
    await page.getByTestId("timeline-wave-2").click();
    await page.getByTestId("checkin-check-all").click();
    await expect(page.getByTestId("checkin-check-all")).toHaveCount(0);
    await openRaceView(page, "Grid");

    // 1) Already on the Start screen: the banner says which wave, Start Now explains instead of doing nothing.
    await expect(page.getByTestId("other-wave-banner")).toContainText("Wave 1 is still in progress");
    // Measured static over 20 frames, but Playwright's stability check keeps failing inside
    // the race-day sheet: click it like a finger would.
    await page.getByTestId("start-all").first().click({ force: true });
    const notice = page.getByTestId("wave-blocked-notice");
    await expect(page.getByTestId("wave-blocked-text")).toHaveText("Wave 1 is still in progress. Please finish it before starting Wave 2.");
    await page.getByTestId("wave-blocked-back").click(); // Back to Race closes the sheet
    await expect(notice).toHaveCount(0);
    await expect(page.getByTestId("wave-sheet")).toHaveCount(0);

    // 2) Race page: Start on the Wave 2 card explains before any Start screen opens.
    await page.getByTestId("wave-act-start-2").click();
    await expect(notice).toBeVisible();
    await expect(page.getByTestId("wave-blocked-text")).toHaveText("Wave 1 is still in progress. Please finish it before starting Wave 2.");
    await expect(page.getByTestId("wave-sheet")).toHaveCount(0);
    await page.getByTestId("wave-blocked-go").click();
    await expect(page).toHaveURL(/\/heat\/1$/);

    // Wave 2 did not start.
    await page.goto("/race/demo-race-99001/heat/2");
    await expect(page.locator('[data-testid^="racing-rider-"]')).toHaveCount(0);
  });
});
