import { test, expect, Page, Request } from "@playwright/test";
import {
  openLiveDemo as openLiveDemoBase,
  racingCard as card,
  tapWithSettle as tap,
  racingBibWithLapsLeft,
  gotoRaceMode,
} from "./helpers";

/**
 * Local-race regression gate (Epic 1, Story 1.1).
 *
 * A Local race — never published — must keep working exactly as it does today,
 * fully offline and with no server. This spec runs a short race-day loop on the
 * demo race and asserts two things that every later story must not break:
 *
 *  1. Behaviour: record a lap, undo it, and the recorded data survives a reload
 *     (IndexedDB is the source of truth).
 *  2. Isolation: the app never talks to anything but its own origin while a
 *     Local race is used (no API, no sync server, no third-party calls).
 */

/** Requests that leave the app's own origin (localhost dev server). */
function trackExternalRequests(page: Page): string[] {
  const external: string[] = [];
  page.on("request", (req: Request) => {
    const url = req.url();
    if (!/^https?:/i.test(url)) return; // data:, blob:, chrome-extension:
    const host = new URL(url).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") external.push(url);
  });
  return external;
}

async function openLiveDemo(page: Page) {
  await page.clock.install({ time: new Date("2026-07-21T09:00:00") });
  await openLiveDemoBase(page);
}

test.describe("Local-race regression gate", () => {
  test("a local race records, undoes and keeps laps across a reload with no external network", async ({ page }) => {
    const external = trackExternalRequests(page);
    await openLiveDemo(page);

    const bib = await racingBibWithLapsLeft(page, 3);
    const lapsOf = async () => Number(((await card(page, bib).getAttribute("data-laps")) ?? "").split("/")[0]);
    const before = await lapsOf();

    // Record two laps (past the 60 s minimum between them).
    await page.clock.fastForward(5 * 60 * 1000);
    await tap(page, bib);
    await expect(card(page, bib)).toHaveAttribute("data-laps", new RegExp(`^${before + 1}/`));
    await page.clock.fastForward(90 * 1000);
    await tap(page, bib);
    await expect(card(page, bib)).toHaveAttribute("data-laps", new RegExp(`^${before + 2}/`));

    // Undo the last one.
    await card(page, bib).dblclick();
    await page.getByRole("button", { name: /Revert Last Lap/ }).click();
    await expect(card(page, bib)).toHaveAttribute("data-laps", new RegExp(`^${before + 1}/`));

    // Let the board hold flush so the persisted state is final, then reload:
    // the recorded lap must come back from IndexedDB.
    await page.clock.fastForward(15 * 1000);
    await page.reload();
    await expect(card(page, bib)).toBeVisible({ timeout: 20_000 });
    await expect(card(page, bib)).toHaveAttribute("data-laps", new RegExp(`^${before + 1}/`));

    expect(external, `unexpected external requests:\n${external.join("\n")}`).toEqual([]);
  });

  test("results stay reachable for a local race with no external network", async ({ page }) => {
    const external = trackExternalRequests(page);
    await openLiveDemo(page);

    await gotoRaceMode(page, "Results");
    await expect(page).toHaveURL(/\/results/);
    // The demo race's categories are listed, with a known demo rider.
    await expect(page.getByTestId("results-category").first()).toBeVisible();
    await expect(page.locator("body")).toContainText("Brooks");

    expect(external, `unexpected external requests:\n${external.join("\n")}`).toEqual([]);
  });
});
