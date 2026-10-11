import { test, expect, Page } from "@playwright/test";
import path from "path";
import { acceptTerms } from "./helpers";

/**
 * The Create Race importer must map columns by HEADER NAME, not position
 * (BUGS.md #19). Same 30 riders, columns in a completely different order, must
 * produce identical riders and categories.
 */
const ORIGINAL = path.resolve(__dirname, "fixtures", "full-race.csv");
const SHUFFLED = path.resolve(__dirname, "fixtures", "full-race-shuffled.csv");

/** Categories as the app derived them: name → "N riders · N laps". */
async function importAndSnapshot(page: Page, name: string, file: string) {
  await page.getByRole("button", { name: /Create new race|^Add$/ }).first().click();
  await expect(page.getByText("Add Race", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Race Name").fill(name);
  await page.locator("#ridersFileUpload").setInputFiles(file);
  await page.getByRole("button", { name: /Done|Saving/ }).click();

  await expect(page.getByText(name).first()).toBeVisible();
  await page.getByText(name).first().click();
  await page.waitForURL(/\/race\/[^/]+$/);

  // Riders, as rendered on the Riders tab.
  await page.getByRole("button", { name: "Riders", exact: true }).click();
  await expect(page.getByText("Riders (30)")).toBeVisible();
  const riderRows = await page
    .locator('[class*="dataRow"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, " ").trim()));

  // Categories, with their derived laps + wave.
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  const catRows = await page
    .locator('[class*="categoryRow"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, " ").trim()));

  await page.goto("/main");
  return { riderRows: riderRows.sort(), catRows: catRows.sort() };
}

test.describe("CSV column order", () => {
  test("header-mapped import is independent of column order", async ({ page }) => {
    await page.goto("/main");
    await acceptTerms(page);

    const original = await importAndSnapshot(page, "Order A", ORIGINAL);
    const shuffled = await importAndSnapshot(page, "Order B", SHUFFLED);

    expect(shuffled.riderRows.length).toBe(30);
    expect(shuffled.catRows.length).toBeGreaterThan(0);
    // Identical riders and identical categories, despite reordered columns.
    expect(shuffled.riderRows).toEqual(original.riderRows);
    expect(shuffled.catRows).toEqual(original.catRows);
  });
});
