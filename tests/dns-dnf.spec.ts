import { test, expect } from "@playwright/test";
import { loadDemoRace, openTab } from "./helpers";

/**
 * Marking riders DNS / DNF from the Schedule tab must not break the app.
 * Expand a category to reveal per-rider status buttons, toggle DNS then DNF,
 * and confirm the Schedule keeps rendering.
 */
test.describe("DNS / DNF status", () => {
  test("toggle DNS and DNF from the schedule without breaking", async ({ page }) => {
    await loadDemoRace(page);

    await test.step("open Schedule and expand riders", async () => {
      await openTab(page, "Schedule");
      await page.getByRole("button", { name: /Expand all riders/i }).click();
      // Status buttons are now visible.
      await expect(page.getByRole("button", { name: "DNS", exact: true }).first()).toBeVisible();
    });

    await test.step("mark a rider DNS then another DNF", async () => {
      await page.getByRole("button", { name: "DNS", exact: true }).first().click();
      await page.getByRole("button", { name: "DNF", exact: true }).first().click();

      // Schedule is still alive — the expand/collapse control remains.
      await expect(page.getByRole("button", { name: /Collapse all riders|Expand all riders/i })).toBeVisible();
      // Toggle DNS back off — round-trips cleanly.
      await page.getByRole("button", { name: "DNS", exact: true }).first().click();
      await expect(page.getByRole("button", { name: "DNS", exact: true }).first()).toBeVisible();
    });
  });
});
