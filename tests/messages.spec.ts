import { test, expect, Page } from "@playwright/test";
import {
  openLiveDemo as openLiveDemoBase,
  racingCard as card,
  tapWithSettle as tap,
  racingBibWithLapsLeft,
} from "./helpers";

/**
 * Story 1.4 — the app's short messages are actually shown. Before a single
 * toast host was mounted, every `toast.*` call (e.g. "Wait 40s before next
 * lap") was silently dropped.
 */

async function openLiveDemo(page: Page) {
  await page.clock.install({ time: new Date("2026-07-21T09:00:00") });
  await openLiveDemoBase(page);
}

test.describe("In-app messages", () => {
  test("a too-fast second lap shows the cooldown on the card and the 'wait' message for a typed bib", async ({ page }) => {
    await openLiveDemo(page);
    const bib = await racingBibWithLapsLeft(page, 3);
    const lapsBefore = (await card(page, bib).getAttribute("data-laps")) ?? "";
    const done = Number(lapsBefore.split("/")[0]);

    await page.clock.fastForward(5 * 60 * 1000);
    await tap(page, bib);
    await expect(card(page, bib)).toHaveAttribute("data-laps", new RegExp(`^${done + 1}/`));

    // The card itself shows the cooldown (and ignores taps)…
    await expect(card(page, bib)).toHaveAttribute("data-cooldown", "true");
    // …while a too-early lap typed as a bib is refused, and the commissaire is told why.
    // Since 0.2.2 bibs are typed on the Keypad tab (the Cards bib field is hidden);
    // Keypad reports the refusal in its entry list instead of a toast.
    await page.clock.fastForward(30 * 1000);
    await page.getByRole("tab", { name: "Keypad" }).click();
    await expect(page.getByTestId("rapid-entry")).toBeVisible();
    await page.keyboard.type(String(bib));
    await page.keyboard.press("Enter");
    await page.clock.fastForward(500);
    const row = page.getByTestId("rapid-row").filter({ hasText: String(bib) }).first();
    await expect(row).toHaveAttribute("data-status", "tooSoon");
    await expect(row).toContainText(/Wait \d+s/);
    await page.getByRole("tab", { name: "Cards" }).click();
    await expect(card(page, bib)).toHaveAttribute("data-laps", new RegExp(`^${done + 1}/`));
  });

  test("messages appear at the bottom of the Live screen", async ({ page }) => {
    await openLiveDemo(page);
    const bib = await racingBibWithLapsLeft(page, 3);
    await page.clock.fastForward(5 * 60 * 1000);
    await tap(page, bib);
    // A message reachable on V1.0's Live screen: cancelling the entry in the rider log.
    await page.getByRole("button", { name: "View rider action history" }).click();
    await page.getByTitle("Cancel this entry").first().click();
    await page.getByRole("button", { name: "Yes, Cancel" }).click();

    const toast = page.getByText(/^Cancelled: /);
    await expect(toast).toBeVisible();
    const box = await toast.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y).toBeGreaterThan(viewport.height / 2);
  });
});
