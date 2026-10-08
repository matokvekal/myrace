import { test, expect } from "@playwright/test";
import { acceptTerms } from "./helpers";

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
});
