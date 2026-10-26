import { test, expect } from "@playwright/test";
import { acceptTerms } from "./helpers";

/**
 * Story 1.5 — Hebrew locale baseline.
 * Hebrew is an explicit choice in the side menu: picking it translates the
 * translated screens and flips the document to RTL, and the choice survives a
 * reload. A browser that merely prefers Hebrew keeps today's English UI.
 */

test.describe("Hebrew locale", () => {
  test("choosing Hebrew translates the UI, sets RTL, and is remembered", async ({ page }) => {
    await page.goto("/main");
    await acceptTerms(page);
    await page.reload();

    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "עברית" }).click();

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page.getByText("המרוצים שלי").first()).toBeVisible();

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText("המרוצים שלי").first()).toBeVisible();

    // Back to English restores today's markup (no dir attribute).
    await page.getByRole("button", { name: "Open menu" }).click();
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("dir", "rtl");
    await expect(page.getByText("My Races").first()).toBeVisible();
  });
});

test.describe("Hebrew browser without a choice", () => {
  test.use({ locale: "he-IL" });

  test("keeps the English UI and left-to-right layout", async ({ page }) => {
    await page.goto("/main");
    await acceptTerms(page);
    await page.reload();
    await expect(page.getByText("My Races").first()).toBeVisible();
    await expect(page.locator("html")).not.toHaveAttribute("dir", "rtl");
  });
});
