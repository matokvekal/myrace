import { expect, test } from "@playwright/test";
import { checkInRow, gotoRaceMode, loadDemoRace, setStatusAtCheckIn } from "./helpers";

// Wave 2 of the demo race hasn't started, so its Check-In is open.
test.describe("Check-In on a narrow phone", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("sheet heights, full names, status menu, late entry and the commissaire's report", async ({ page }) => {
    await loadDemoRace(page);
    await gotoRaceMode(page, "Race");
    if (await page.getByTestId("wave-sheet").isVisible().catch(() => false)) {
      await page.getByTestId("sheet-backdrop").click({ position: { x: 5, y: 5 } });
    }
    await expect(page.getByTestId("wave-act-changes-2")).toHaveCount(0);

    await page.getByTestId("wave-act-checkin-2").click();
    const sheet = page.getByTestId("wave-sheet");
    await expect.poll(async () => Math.round(((await sheet.boundingBox())!.height / 800) * 100)).toBe(70);

    // Drag up: at most 95% of the page (once the sheet has slid into place)
    await page.waitForTimeout(350);
    const handle = (await page.getByRole("button", { name: "Expand panel" }).boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, 20, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Math.round(((await sheet.boundingBox())!.height / 800) * 100)).toBe(95);

    const row = page.locator('[data-testid^="checkin-row-"]').first();
    const bib = Number((await row.getAttribute("data-testid"))!.replace("checkin-row-", ""));

    // The name is never cut, and DNS lives in the menu
    const name = row.locator('[class*="name"]').first();
    expect(await name.evaluate((e) => e.scrollHeight <= e.clientHeight + 1)).toBe(true);
    await expect(row.getByText("DNS", { exact: true })).toHaveCount(0);

    await row.getByRole("button", { name: "Status" }).click();
    const modal = page.getByTestId("status-modal");
    await expect(modal.getByText("DNF", { exact: true })).toHaveCount(0);
    await expect(modal.getByText("Running", { exact: true })).toHaveCount(0);
    await expect(modal.getByText("Finished", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("status-modal.png") });
    await modal.getByRole("button", { name: "Close" }).click();

    await setStatusAtCheckIn(page, bib, "DNS");
    await expect(checkInRow(page, bib).getByRole("button", { name: /DNS/ })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("checkin-row.png") });

    // Change the bib too, with the pencil next to the bib number
    await page.getByTestId(`checkin-editbib-${bib + 1}`).click();
    await page.getByTestId(`checkin-bibinput-${bib + 1}`).fill("777");
    await page.getByRole("button", { name: "Save bib" }).click();
    await expect(checkInRow(page, 777)).toBeVisible();

    // A late entry, added from the category's icon (same form as CREATE > Riders)
    const addIcon = page.locator('[data-testid^="checkin-add-"]').first();
    const category = (await addIcon.getAttribute("data-testid"))!.replace("checkin-add-", "");
    await addIcon.click();
    const add = page.getByTestId("checkin-add-modal");
    await expect(add).toContainText(`Add rider to ${category}`);
    await page.screenshot({ path: test.info().outputPath("add-rider.png") });
    await add.getByPlaceholder("Bib *").fill("778");
    await add.getByPlaceholder("First name *").fill("Late");
    await add.getByPlaceholder("Last name *").fill("Entry");
    await add.getByRole("button", { name: "Add Rider" }).click();
    await expect(add).toHaveCount(0);
    await expect(checkInRow(page, 778)).toBeVisible();

    await page.getByTestId("sheet-backdrop").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.getByRole("button", { name: "Close", exact: true }).click().catch(() => {});

    // The main commissaire sees both, from the warning button by Check-In
    await page.getByTestId("wave-act-changes-2").click();
    const report = page.getByTestId("checkin-changes");
    await expect(report.getByTestId("checkin-change")).toHaveCount(3);
    await expect(report).toContainText(`standing → DNS`);
    await expect(report).toContainText(`Bib ${bib + 1} → 777`);
    await expect(report).toContainText(`Added to ${category}`);
    await page.screenshot({ path: test.info().outputPath("report.png") });
  });
});
