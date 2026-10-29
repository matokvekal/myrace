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
    await page.clock.fastForward(30 * 1000);
    await page.getByLabel("Bib").fill(String(bib));
    await page.getByLabel("Bib").press("Enter");
    await page.clock.fastForward(500);
    await expect(page.getByText(/Wait \d+s before next lap/)).toBeVisible();
    await expect(card(page, bib)).toHaveAttribute("data-laps", new RegExp(`^${done + 1}/`));
  });

  test("messages appear at the bottom, clear of the bib search", async ({ page }) => {
    await openLiveDemo(page);
    const bib = await racingBibWithLapsLeft(page, 3);
    await page.clock.fastForward(5 * 60 * 1000);
    await tap(page, bib);
    await page.clock.fastForward(30 * 1000);
    await page.getByLabel("Bib").fill(String(bib));
    await page.getByLabel("Bib").press("Enter");
    await page.clock.fastForward(500);

    const toast = page.getByText(/Wait \d+s before next lap/);
    await expect(toast).toBeVisible();
    const box = await toast.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.y).toBeGreaterThan(viewport.height / 2);
  });
});
