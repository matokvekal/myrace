import { test, expect } from "@playwright/test";
import { loadDemoRace, openTab } from "./helpers";

/**
 * Editing an individual rider must not break the app:
 *   open a rider → change the name → add a start time → save → values persist.
 *
 * Covers the "change names" and "add time" requirements via the rider detail
 * modal (opened by tapping a rider row on the Riders tab).
 */
test.describe("Rider edits", () => {
  test("change a rider's name and start time without breaking", async ({ page }) => {
    await loadDemoRace(page);

    await test.step("open the Riders tab (table view)", async () => {
      await openTab(page, "Riders");
      await expect(page.getByText(/Riders \(\d+\)/)).toBeVisible();
    });

    await test.step("open the first rider's detail modal", async () => {
      // Rows are CSS-module classed; match the stable base name substring.
      await page.locator('[class*="dataRow"]').first().click();
      // The modal exposes an Edit button.
      await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    });

    await test.step("edit name + start time and save", async () => {
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByPlaceholder("Last name").fill("QAEDITED");
      await page.getByPlaceholder("HH:MM").fill("10:15");
      await page.getByRole("button", { name: /Save/i }).click();
      // Edit button returns → save completed cleanly (no crash / stuck spinner).
      await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
    });

    await test.step("changes persist in the list and on reopen", async () => {
      // Close the modal (close button has no accessible name; target its class).
      await page.locator('[class*="closeBtn"]').first().click();
      // The renamed rider shows in the underlying list.
      await expect(page.getByText("QAEDITED").first()).toBeVisible();
      // Reopen the rider — the modal now reflects the saved start time.
      await page.getByText("QAEDITED").first().click();
      await expect(page.getByText("10:15")).toBeVisible();
    });
  });
});
