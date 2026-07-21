import { test, expect } from "@playwright/test";
import { acceptTerms } from "./helpers";

/**
 * The side menu carries the direct feedback line to the author. It's the only
 * route a user has for reporting a bug, so it should not silently disappear.
 */
const FEEDBACK_EMAIL = "mictavim@gmail.com";

test.describe("Side menu", () => {
  test("offers a direct feedback email", async ({ page }) => {
    await page.goto("/main");
    await acceptTerms(page);

    await page.getByRole("button", { name: "Open menu" }).click();

    await expect(page.getByText("Comments? Bugs?")).toBeVisible();
    const link = page.getByRole("link", { name: FEEDBACK_EMAIL });
    await expect(link).toBeVisible();
    // mailto, pre-filled subject so replies are easy to triage.
    await expect(link).toHaveAttribute("href", new RegExp(`^mailto:${FEEDBACK_EMAIL}\\?subject=`));
  });
});
