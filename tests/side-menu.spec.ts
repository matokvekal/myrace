import { test, expect } from "@playwright/test";
import { acceptTerms } from "./helpers";

/**
 * The side menu carries the direct feedback line to the author. It's the only
 * route a user has for reporting a bug, so it should not silently disappear.
 */
const FEEDBACK_EMAIL = "info@commissaire.us";

test.describe("Side menu", () => {
  test("offers a direct feedback email", async ({ page }) => {
    await page.goto("/main");
    await acceptTerms(page);

    const menuButton = page.getByRole("button", { name: "Open menu" });
    await expect(menuButton).toBeVisible();
    await menuButton.click();

    await expect(page.getByText("Comments? Bugs?")).toBeVisible();
    const link = page.getByRole("link", { name: FEEDBACK_EMAIL });
    await expect(link).toBeVisible();
    // mailto, pre-filled subject so replies are easy to triage.
    await expect(link).toHaveAttribute("href", new RegExp(`^mailto:${FEEDBACK_EMAIL}\\?subject=`));
  });

  test("board hold defaults to 2s and persists the chosen value", async ({ page }) => {
    await page.goto("/main");
    await acceptTerms(page);
    await page.getByRole("button", { name: "Open menu" }).click();

    const select = page.getByRole("combobox", { name: "Board hold delay" });
    await expect(select).toHaveValue("2000");

    await select.selectOption("5000");
    await page.getByRole("button", { name: "Close menu" }).click();

    // Persisted in localStorage (`commissaire.boardHold`), so it survives the
    // reload a commissaire does mid-event.
    await page.reload();
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("combobox", { name: "Board hold delay" })).toHaveValue("5000");
  });
});
