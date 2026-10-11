import { test, expect } from "@playwright/test";
import { loadDemoRace, openTab, openLiveDemo, racingCard, finishedCard } from "./helpers";

/**
 * Browser smoke test of the post-race features, on the built-in demo race.
 *
 * Safe against production: every Playwright test runs in a fresh browser context
 * (empty IndexedDB), so the demo race lives only in that throwaway profile and no
 * real race data is read or written. Run it against the live site with:
 *   E2E_BASE_URL=https://commissaire.us npx playwright test tests/ui-smoke.spec.ts
 */

test.describe("UI smoke", () => {
  test("phase tabs read Create / Race / Live", async ({ page }) => {
    await loadDemoRace(page);
    for (const name of ["Create", "Race", "Live"]) {
      await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Start", exact: true })).toHaveCount(0);
  });

  test("Schedule: open a rider, edit the name, see it update", async ({ page }) => {
    await loadDemoRace(page);
    await openTab(page, "Schedule");
    await page.getByText(/\d+ riders/).first().click();
    await page.getByTitle("Rider details").first().click();
    await page.getByRole("button", { name: /^Edit$/ }).click();
    const first = page.getByPlaceholder("First name");
    await first.fill("Smokey");
    await page.getByRole("button", { name: /Save/ }).click();
    await expect(page.getByTitle("Rider details").filter({ hasText: "Smokey" }).first()).toBeVisible();
  });

  test("Riders: wave grouping and search by name and bib", async ({ page }) => {
    await loadDemoRace(page);
    await openTab(page, "Riders");
    await expect(page.getByTestId("wave-group-1")).toBeVisible();
    await expect(page.getByTestId("wave-group-2")).toBeVisible();
    await expect(page.getByTestId("rider-category-header").first()).toBeVisible();
    const before = await page.getByTestId("rider-category-header").count();

    const box = page.getByTestId("rider-search");
    await box.fill("1");
    const afterBib = await page.getByTestId("rider-category-header").count();
    expect(afterBib).toBeLessThanOrEqual(before);
    await box.fill("zzzz-no-such-rider");
    await expect(page.getByTestId("rider-category-header")).toHaveCount(0);
    await box.fill("");
    await expect(page.getByTestId("rider-category-header")).toHaveCount(before);
  });

  test("Schedule: edit a category colour and a wave colour", async ({ page }) => {
    await loadDemoRace(page);
    await openTab(page, "Schedule");

    // category (upcoming one: the first running categories are editable too, finished are not)
    await page.locator('[data-testid^="edit-color-"]:not([disabled])').first().click();
    await page.getByTestId("color-input").evaluate((el: HTMLInputElement) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(el, "#ff8800");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.getByTestId("color-save").click();
    await expect(page.getByTestId("color-input")).toHaveCount(0);

    // wave
    await page.getByTestId("edit-wave-color-2").click();
    await page.getByTestId("wave-color-input").evaluate((el: HTMLInputElement) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(el, "#00aa55");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.getByTestId("wave-color-save").click();
    await expect(page.getByTestId("wave-color-input")).toHaveCount(0);
    // persisted: reopening shows the saved colour
    await page.getByTestId("edit-wave-color-2").click();
    await expect(page.getByText(/Current #00aa55/i)).toBeVisible();
  });

  test("Board: complete board with expandable results", async ({ page }) => {
    await loadDemoRace(page);
    await page.getByRole("tab", { name: "Race", exact: true }).click();
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.getByTestId("board-wave-1")).toBeVisible();
    await expect(page.getByTestId("board-wave-2")).toBeVisible();
    const toggle = page.locator('[data-testid^="board-expand-"]').first();
    await toggle.click();
    await expect(page.locator('[data-testid^="board-results-"]').first()).toBeVisible();
    await expect(page.getByTestId("board-result-row").first()).toContainText(/P1/);
  });

  test("Live: manual Finish Race, undo, then redo restores the same finish", async ({ page }) => {
    await openLiveDemo(page);
    const id = await page.locator('[data-testid^="racing-rider-"]').first().getAttribute("data-testid");
    const bib = Number(id!.replace("racing-rider-", ""));

    await racingCard(page, bib).dblclick();
    await page.getByRole("button", { name: /Finish Race/ }).click();
    await expect(finishedCard(page, bib)).toBeVisible();
    await expect(racingCard(page, bib)).toHaveCount(0);

    // undo from the rider log
    await page.getByRole("button", { name: "View rider action history" }).click();
    await page.getByTitle(/Cancel this/).first().click();
    await page.getByRole("button", { name: /Yes, Cancel/ }).click();
    await page.getByRole("button", { name: "Close rider log" }).click();
    await expect(racingCard(page, bib)).toBeVisible();

    // redo
    await page.getByTestId("redo-finish").click();
    await expect(finishedCard(page, bib)).toBeVisible();
    await expect(page.getByTestId("redo-finish")).toHaveCount(0);
  });

  test("Live: individual bell at 2 laps, last-lap flag at 1 lap", async ({ page }) => {
    await openLiveDemo(page);
    // The demo seeds Elite Men mid-race: leader on 6/7 (flag) with others further back.
    await expect(page.locator('[data-testid^="racing-rider-"] [title^="Last lap"]').first()).toBeVisible();
    await expect(page.locator('[data-testid^="racing-rider-"] [title^="2 laps left"]').first()).toBeVisible();
  });
});
