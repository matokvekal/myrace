import { test, expect } from "@playwright/test";
import { acceptTerms, gotoRaceMode, loadDemoRace } from "./helpers";

/**
 * Creating a race with NO start list must still work — the import path is
 * awaited now (BUGS.md #18), so the no-file branch needs its own guard.
 */
test.describe("Create race", () => {
  test("creates a race with no riders file", async ({ page }) => {
    await page.goto("/main");
    await acceptTerms(page);

    // Either entry point is fine. Which one shows depends on whether the races
    // list has finished loading — on a cold dev server this test can arrive
    // first and catch the in-between render.
    await page
      .getByRole("button", { name: /Create new race|^Add$/ })
      .first()
      .click();
    await expect(page.getByText("Add Race", { exact: true })).toBeVisible();

    await page.getByPlaceholder("Race Name").fill("Empty Race");
    await page.getByPlaceholder("Location").fill("Nowhere");
    await page.getByRole("button", { name: /Done|Saving/ }).click();

    // Back on the list with the new race present.
    await expect(page.getByText("Empty Race").first()).toBeVisible();
    await page.getByText("Empty Race").first().click();
    await page.waitForURL(/\/race\/[^/]+$/);

    // It opens cleanly with an empty field rather than erroring.
    await page.getByRole("button", { name: "Riders", exact: true }).click();
    await expect(page.getByText("No riders yet.")).toBeVisible();
  });

  test("a new race opens on Create even after another race was left in Race mode", async ({ page }) => {
    await loadDemoRace(page);
    await gotoRaceMode(page, "Race");

    // Back to the list inside the app: a full page load would reset the in-memory mode.
    const backdrop = page.getByTestId("sheet-backdrop");
    if (await backdrop.isVisible().catch(() => false)) await backdrop.click({ position: { x: 5, y: 5 } });
    await page.getByTestId("race-menu-btn").click();
    await page.getByRole("button", { name: "All Races" }).click();
    await page.waitForURL(/\/main/);

    await page.getByRole("button", { name: /Create new race|^Add$/ }).first().click();
    await page.getByPlaceholder("Race Name").fill("Second Race");
    await page.getByPlaceholder("Location").fill("Nowhere");
    await page.getByRole("button", { name: /Done|Saving/ }).click();
    await page.getByText("Second Race").first().click();
    await page.waitForURL(/\/race\/[^/]+$/);

    await page.getByRole("button", { name: "Riders", exact: true }).click();
    await expect(page.getByRole("button", { name: "Import CSV" })).toBeVisible();

    // Choosing Race on the empty race offers the way back to adding riders.
    await page.getByTestId("race-menu-btn").click();
    await page.getByTestId("race-nav-race").click();
    await expect(page.getByTestId("race-mode-empty")).toBeVisible();
    await page.getByTestId("race-mode-add-riders").click();
    await expect(page.getByRole("button", { name: "Import CSV" })).toBeVisible();
  });
});
