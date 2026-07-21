import { test, expect } from "@playwright/test";
import path from "path";
import { loadDemoRace, openTab, DEMO_RIDER_COUNT } from "./helpers";

/**
 * Uploading a CSV file adds riders and doesn't break the app.
 * Uses the Edit-Riders CSV importer (Actions → Edit Riders → 📁 CSV), which is
 * the simple pick-file → preview → confirm path.
 */
const FIXTURE = path.resolve(__dirname, "fixtures", "riders-import.csv");
const IMPORT_COUNT = 3;

test.describe("CSV upload", () => {
  test("import riders from a CSV file", async ({ page }) => {
    await loadDemoRace(page);

    await test.step("open Edit Riders", async () => {
      await openTab(page, "Riders");
      await page.getByRole("button", { name: "Actions" }).click();
      await page.getByRole("menuitem", { name: /Edit Riders/i }).click();
      await expect(page.getByPlaceholder(/Name or bib/i)).toBeVisible();
      await expect(page.getByText(`${DEMO_RIDER_COUNT} riders`)).toBeVisible();
    });

    await test.step("upload the CSV file", async () => {
      // The file input is hidden; set files on it directly.
      await page.locator('input[type="file"]').setInputFiles(FIXTURE);
      // Preview appears with the parsed row count.
      await expect(page.getByText(`Import ${IMPORT_COUNT} riders`).first()).toBeVisible();
      await page.getByRole("button", { name: `Import ${IMPORT_COUNT} riders` }).click();
    });

    await test.step("riders were added", async () => {
      await expect(
        page.getByText(`${DEMO_RIDER_COUNT + IMPORT_COUNT} riders`)
      ).toBeVisible();
      // The imported riders now appear in the list (search by name to isolate).
      // Retried: the row count updates as soon as the import lands, but the list
      // can still be re-rendering when the search is typed, which dropped the
      // filter on the floor and left the assertion looking at an unfiltered list.
      await expect(async () => {
        await page.getByPlaceholder(/Name or bib/i).fill("901");
        await expect(page.getByText("#901").first()).toBeVisible({ timeout: 2_000 });
        await expect(page.getByText(/McTestface/i).first()).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 20_000 });
    });
  });
});
