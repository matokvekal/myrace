import { test, expect, Page } from "@playwright/test";
import { acceptTerms } from "./helpers";

/**
 * Phase 2 — duplicate bibs are resolved BEFORE an import saves anything:
 *  - Create Race: the same bib in two waves blocks the preview confirm until the organizer
 *    confirms the proposed number (21 → 1021); the race then has unique bibs.
 *  - Import wizard into that race: a bib already in the race (other wave) gets 1021's next
 *    free number (2021); Back cancels; confirm saves; Rider Details shows the audit note.
 * Local race (no server needed).
 */
const csv = (rows: string[]) => ({ name: "start.csv", mimeType: "text/csv", buffer: Buffer.from(["Bib,First Name,Last Name,Category,Heat", ...rows].join("\n")) });

async function createRace(page: Page, name: string) {
  await page.getByRole("button", { name: /Create new race|^Add$/ }).first().click();
  await expect(page.getByText("Add Race", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Race Name").fill(name);
  await page.locator("#ridersFileUpload").setInputFiles(csv(["21,Dana,Levi,Elite,1", "21,Noa,Bar,Kids,2", "30,Avi,Tal,Kids,2"]));

  const box = page.getByTestId("import-bib-conflicts");
  await expect(box).toHaveAttribute("data-resolved", "false");
  await expect(page.getByTestId("import-preview-confirm")).toBeDisabled();
  await page.getByTestId("import-bib-resolve").click();
  await expect(page.getByTestId("bib-choice-1")).toHaveValue("1021");
  await page.getByTestId("bib-conflicts-confirm").click();
  await expect(box).toHaveAttribute("data-resolved", "true");
  await page.getByTestId("import-preview-confirm").check();
  await page.getByRole("button", { name: /Done|Saving/ }).click();
  await expect(page.getByText(name).first()).toBeVisible();
  await page.getByText(name).first().click();
  await page.waitForURL(/\/race\/[^/]+$/);
  await page.getByRole("button", { name: "Riders", exact: true }).click();
}

test("duplicate bibs: resolved at Create Race and at import, never saved twice", async ({ page }) => {
  await page.goto("/main");
  await acceptTerms(page);
  // Server builds need an account to browse / create (the shared-race path is covered by
  // race-persistence.spec.ts "start list imported …" against a real API).
  test.skip(/\/account/.test(page.url()) || !!process.env.E2E_API_URL, "server build: needs an account");

  await createRace(page, `Dups ${Date.now()}`);
  await expect(page.getByText("Riders (3)")).toBeVisible();
  await expect(page.getByText("1021", { exact: true }).first()).toBeVisible();

  // Wizard: bib 21 again (taken in wave 1) and 40 twice in the file.
  await page.getByTestId("rider-manage-btn").click();
  await page.getByRole("button", { name: "Import CSV" }).click();
  await page.locator('input[type="file"][accept=".csv,.xlsx,.xls"]').setInputFiles(csv(["21,Late,Rider,Kids,2", "40,Ron,Gal,Elite,1", "40,Tom,Lev,Kids,2"]));
  await page.getByRole("button", { name: "Continue to Preview" }).click();
  await page.getByTestId("preview-import").click();

  await expect(page.getByTestId("bib-conflicts")).toBeVisible();
  await expect(page.getByTestId("bib-group-21")).toContainText("Already in this race");
  await expect(page.getByTestId("bib-choice-0")).toHaveValue("2021"); // 1021 is taken
  await expect(page.getByTestId("bib-choice-2")).toHaveValue("1040");

  // Back = cancel: nothing saved.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("preview-import")).toBeVisible();
  await page.getByTestId("preview-import").click();

  // Manual override that collides is refused until fixed.
  await page.getByTestId("bib-choice-2").fill("30");
  await expect(page.getByTestId("bib-conflicts-confirm")).toBeDisabled();
  await page.getByTestId("bib-choice-2").fill("777");
  await page.getByTestId("bib-conflicts-confirm").click();

  // The wizard closes on success: every bib of the race is unique now.
  await expect(page.getByText("Riders (6)")).toBeVisible();
  for (const bib of ["2021", "40", "777"]) await expect(page.getByText(bib, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("6 valid", { exact: false })).toBeVisible();

  // Rider Details shows the audited renumbering.
  await page.getByText("Rider Late").click();
  await expect(page.getByTestId("rider-import-bib-note")).toContainText("Bib changed at import: 21 → 2021");
});
