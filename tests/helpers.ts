import { expect, Page } from "@playwright/test";

/** Number of riders the demo race seeds (40 across 8 categories / 2 waves). */
export const DEMO_RIDER_COUNT = 40;

/**
 * Load the built-in demo race. Each Playwright test gets a fresh browser
 * context (empty IndexedDB), so /main always offers the "Try Demo Race" button
 * and the seed navigates to /race/demo-race-99001.
 */
/**
 * Dismiss the Terms & Conditions gate. Every test runs in a fresh profile, so
 * the gate is up on first load and blocks every other control on the page.
 * No-op once accepted.
 */
export async function acceptTerms(page: Page): Promise<void> {
  const gate = page.getByRole("dialog", { name: /Terms and Conditions/i });
  if ((await gate.count()) === 0) return;
  await gate.getByRole("checkbox").check();
  await gate.getByRole("button", { name: /Agree & Continue/ }).click();
  await expect(gate).toHaveCount(0);
}

export async function loadDemoRace(page: Page): Promise<void> {
  await page.goto("/main");
  await acceptTerms(page);
  const demoBtn = page.getByRole("button", { name: /Try Demo Race/i });
  await expect(demoBtn).toBeVisible();
  await demoBtn.click();
  await page.waitForURL(/\/race\/demo-race-99001/);
  // The demo seeds mid-race, so the first open in a session bounces straight to
  // the Live screen (one-shot, sessionStorage-flagged). Come back to Setup so the
  // tab bar is available. Retried because the bounce lands after mount, which can
  // be either side of our first look.
  await expect(async () => {
    if (/\/heat\//.test(page.url())) {
      await page.getByRole("tab", { name: "Race", exact: true }).click();
    }
    // The race tab bar is up once the Riders tab button is present.
    await expect(page.getByRole("button", { name: "Riders", exact: true })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
}

/** Open a top-level race tab (Schedule / Categories / Riders / Results / …). */
export async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
}

/** Pick a wave in race mode. Pills read like "2 · 09:00". */
export async function selectWave(page: Page, wave: number): Promise<void> {
  await page
    .locator('button[class*="wavePill"]', { hasText: new RegExp(`^${wave}\\b`) })
    .first()
    .click();
}
