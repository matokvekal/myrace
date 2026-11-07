/**
 * Rapid Entry (keypad) — acceptance scenario on the LOCAL stack, never production.
 *
 *   npm --prefix server run e2e:stack
 *   E2E_API_URL=http://localhost:4100 E2E_BASE_URL=http://localhost:3100 \
 *     npx playwright test tests/rapid-entry.spec.ts --workers=1
 *
 * Leaves the race on the local server for manual testing: sign in at
 * http://localhost:3100/account as RAPID_EMAIL / RAPID_PASSWORD.
 * Bibs overlap on purpose (1 / 18 / 182, 34 → 341) and span three waves.
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { acceptTerms, gotoRaceMode, openRaceView } from "./helpers";

const API_ORIGIN = process.env.E2E_API_URL;
test.skip(!API_ORIGIN, "needs the local Commissaire stack: E2E_API_URL + E2E_BASE_URL");
test.setTimeout(5 * 60_000);

export const RAPID_EMAIL = "rapid.judge@local.test";
export const RAPID_PASSWORD = "rapid-entry-1";
const RACE_NAME = `Rapid Entry ${new Date().toTimeString().slice(0, 8)}`;

// [bib, category, wave, start]
const RIDERS: Array<[number, string, number, string]> = [
  ...[1, 18, 182, 341, 431, 2, 25, 250].map((b) => [b, "Elite Men", 1, "09:00"] as [number, string, number, string]),
  ...[7, 77, 9, 90].map((b) => [b, "Masters 40-49", 1, "09:00"] as [number, string, number, string]),
  ...[3, 33, 333, 345, 40, 404].map((b) => [b, "Juniors", 2, "09:30"] as [number, string, number, string]),
  ...[6, 600, 601].map((b) => [b, "Kids", 3, "10:00"] as [number, string, number, string]),
];

function startList(): string {
  const rows = ["Bib,First Name,Last Name,Category,Wave,Start Time,Laps"];
  for (const [bib, cat, wave, start] of RIDERS) rows.push(`${bib},Rider${bib},Test${bib},${cat},${wave},${start},5`);
  const file = path.join(os.tmpdir(), `rapid-entry-${Date.now()}.csv`);
  fs.writeFileSync(file, rows.join("\n") + "\n", "utf8");
  return file;
}

async function signInOrRegister(page: Page) {
  await page.goto("/account");
  await page.getByPlaceholder("Email").fill(RAPID_EMAIL);
  await page.getByPlaceholder(/Password/).first().fill(RAPID_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  const ok = await page.waitForURL(/\/main/, { timeout: 6_000 }).then(() => true).catch(() => false);
  if (ok) return;
  await page.goto("/account");
  await page.getByRole("tab", { name: "New account" }).click();
  await page.getByPlaceholder("Your name").fill("Rapid Judge");
  await page.getByPlaceholder("Email").fill(RAPID_EMAIL);
  await page.getByPlaceholder("Password (8+ characters)").fill(RAPID_PASSWORD);
  await page.getByPlaceholder("Repeat password").fill(RAPID_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/main/, { timeout: 20_000 });
}

const type = async (page: Page, digits: string) => {
  for (const d of digits) await page.getByTestId(`rapid-key-${d}`).dispatchEvent("pointerdown");
};

test("keypad: unambiguous bibs auto-accept, ambiguous ones need Enter, invalid ones go red", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("/main");
  await acceptTerms(page);

  await test.step("race with overlapping bibs in three waves, wave 1 started", async () => {
    await signInOrRegister(page);
    await page.goto("/main");
    await page.getByRole("button", { name: /Create new race|Add/ }).first().click();
    await page.getByPlaceholder("Race Name").fill(RACE_NAME);
    await page.locator("#ridersFileUpload").setInputFiles(startList());
    await expect(page.getByTestId("import-preview")).toContainText(`${RIDERS.length} riders`);
    await page.getByTestId("import-preview-confirm").check();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText(/saved to the server/i)).toBeVisible({ timeout: 30_000 });
    await page.getByText(RACE_NAME).first().click();
    await page.waitForURL("**/race/**", { timeout: 20_000 });

    await openRaceView(page, "Check-In");
    await page.getByTestId("checkin-check-all").click();
    await openRaceView(page, "Grid");
    const blocks = page.getByTestId("simple-start-group");
    await expect(blocks.first()).toBeVisible();
    // Start status colours: red before, orange while standing (countdown, before GO), green after GO.
    await expect(blocks.first()).toHaveAttribute("data-start-state", "notStarted");
    await blocks.first().getByRole("button", { name: "+1 Minute" }).click();
    await expect(blocks.first()).toHaveAttribute("data-start-state", "standing");
    const n = await blocks.count();
    for (let i = 0; i < n; i++) {
      await blocks.nth(i).getByTestId("start-all").click();
      await expect(blocks.nth(i).getByText(/Started/)).toBeVisible({ timeout: 15_000 });
      await expect(blocks.nth(i)).toHaveAttribute("data-start-state", "started");
    }
    await gotoRaceMode(page, "Live");
    await page.waitForURL(/\/heat\/1$/, { timeout: 20_000 });
  });

  await test.step("switch to the keypad", async () => {
    await page.getByTestId("mode-keypad").click();
    await expect(page.getByTestId("rapid-entry")).toBeVisible();
    await page.screenshot({ path: path.join(os.tmpdir(), "rapid-entry-empty.png") });
  });

  await test.step("431, 182, 341 auto; 18 and 1 by Enter; 34 waits; 999 and 345 (wave 2) red", async () => {
    const rows = page.getByTestId("rapid-row");
    await type(page, "431");
    await type(page, "182");
    await type(page, "34");
    await expect(page.getByTestId("rapid-display")).toContainText("34"); // incomplete prefix waits
    await type(page, "1");
    await type(page, "18");
    await expect(page.getByTestId("rapid-display")).toHaveAttribute("data-match", "ambiguous");
    await page.getByTestId("rapid-key-enter").dispatchEvent("pointerdown");
    await type(page, "1");
    await page.getByTestId("rapid-key-enter").dispatchEvent("pointerdown");
    await type(page, "999");
    await page.waitForTimeout(700); // invalid-clear pause
    await type(page, "345");
    await page.waitForTimeout(800); // invalid-clear
    await expect(rows).toHaveCount(7);
    const texts = await rows.allInnerTexts();
    // newest first
    expect(texts[0]).toMatch(/345[\s\S]*Wave 2/i);
    expect(texts[1]).toMatch(/999[\s\S]*Unknown/i);
    expect(texts.slice(2).map((t) => t.trim().split(/\s/)[0])).toEqual(["1", "18", "341", "182", "431"]);
    for (const t of texts.slice(2)) expect(t).toMatch(/4 left/i); // 5 laps, lap 1 done
    // Order arrows reorder this list only.
    await rows.nth(2).getByTestId("rapid-row-down").click();
    expect((await rows.nth(2).innerText()).trim().split(/\s/)[0]).toBe("18");
    await page.screenshot({ path: path.join(os.tmpdir(), "rapid-entry-history.png") });
    // Visual themes follow <html data-theme>: light (blue) and dark (gold).
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await expect(page.getByTestId("rapid-key-enter")).toHaveCSS("color", "rgb(10, 15, 28)");
    await page.screenshot({ path: path.join(os.tmpdir(), "rapid-entry-dark.png") });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await expect(page.getByTestId("rapid-key-enter")).toHaveCSS("color", "rgb(255, 255, 255)");
  });

  await test.step("same bib again is 'too soon', not a second lap", async () => {
    await type(page, "431");
    await expect(page.getByTestId("rapid-row").first()).toContainText(/Wait/i);
  });

  await test.step("back to the cards: keypad laps are on the board, and a card tap still records", async () => {
    await page.getByTestId("mode-cards").click();
    await expect(page.getByTestId("rapid-entry")).toHaveCount(0);
    await expect(page.locator('[data-testid="racing-rider-431"]')).toBeVisible();
    await page.locator('[data-testid="racing-rider-25"]').click();
    await page.waitForTimeout(600);
    await page.getByTestId("mode-keypad").click();
    await expect.poll(async () => (await page.getByTestId("rapid-row").count())).toBeGreaterThan(0);
    await page.getByTestId("mode-cards").click();
    await expect(page.locator('[data-testid="racing-rider-25"]')).toContainText(/1/);
  });

  await ctx.close();
});
