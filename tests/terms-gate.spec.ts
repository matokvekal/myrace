import { test, expect } from "@playwright/test";

/**
 * Terms & Conditions acceptance. The app is free with no login, so there is no
 * startup dialog any more (`TermsGate` is gone) — acceptance is a checkbox on
 * the LANDING page that gates the "enter the app" CTAs. Every other spec seeds
 * the persisted record and jumps straight to /main, so this is the only place
 * the real gate is exercised.
 *
 * See `legal/termsAcceptance.ts`; bumping TERMS_VERSION re-prompts everyone.
 */

test.describe("Terms gate (landing page)", () => {
  test("blocks the CTA until the box is ticked, then remembers the acceptance", async ({ page }) => {
    await page.goto("/");

    const start = page.getByRole("button", { name: /Press Start/ });
    // The gate is rendered above BOTH CTAs ("Press Start" up top, "Enter the
    // App" further down), so there are two checkboxes driving the same state.
    const agree = page.getByRole("checkbox", { name: /I have read and agree/ });

    // Fresh profile: the CTA is dead until the terms are accepted.
    await expect(start).toBeDisabled();
    await expect(page.getByRole("button", { name: /Enter the App/ })).toBeDisabled();
    await expect(agree).toHaveCount(2);

    // `.click()`, not `.check()` — accepting unmounts the whole gate, so
    // check()'s "is it now checked?" verification races against the element
    // disappearing and times out.
    await agree.first().click();
    await expect(start).toBeEnabled();
    await expect(page.getByRole("button", { name: /Enter the App/ })).toBeEnabled();
    // The ask is one-shot — once accepted the checkboxes stop nagging.
    await expect(agree).toHaveCount(0);

    await start.click();
    await page.waitForURL(/\/main/);

    // Acceptance is persisted and versioned, so coming back doesn't re-ask.
    await page.goto("/");
    await expect(page.getByRole("checkbox", { name: /I have read and agree/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Press Start/ })).toBeEnabled();
  });

  test("the terms text is reachable from the landing page", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: /Terms/i }).first()).toBeVisible();
  });
});
