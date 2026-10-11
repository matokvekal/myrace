import { test, expect, Page } from "@playwright/test";
import {
  openLiveDemo as openLiveDemoBase,
  racingCard as card,
  finishedCard as finished,
  tapWithSettle as tap,
  racingBibWithLapsLeft,
} from "./helpers";

/**
 * Safety net for the lap-recording core on the Live screen — the highest-risk
 * code in the app, and the part task 29 extracts into a hook. These assert the
 * behaviour that must survive that refactor unchanged.
 *
 * Uses the demo race, which seeds mid-race with wave 1 already on course, and a
 * fake clock (the 60 s minimum between laps and the 300 ms tap-disambiguation
 * timer both make real time unusable — see the full-race spec).
 */

/** This spec always wants the clock installed before landing on Live. */
async function openLiveDemo(page: Page) {
  await page.clock.install({ time: new Date("2026-07-21T09:00:00") });
  await openLiveDemoBase(page);
}

/** Any bib currently racing. */
async function anyRacingBib(page: Page): Promise<number> {
  const id = await page
    .locator('[data-testid^="racing-rider-"]')
    .first()
    .getAttribute("data-testid");
  return Number(id!.replace("racing-rider-", ""));
}

/** `spare`-laps-left bibs, `count` of them, in board order. */
async function racingBibsWithLapsLeft(page: Page, spare: number, count: number): Promise<number[]> {
  const cards = await page
    .locator('[data-testid^="racing-rider-"]')
    .evaluateAll((els) =>
      els.map((el) => {
        const e = el as HTMLElement;
        return { testid: e.dataset.testid ?? "", laps: e.dataset.laps ?? "" };
      })
    );
  const hits = cards
    .filter((c) => {
      const [done, total] = c.laps.split("/").map(Number);
      return Number.isFinite(done) && Number.isFinite(total) && total - done >= spare;
    })
    .map((c) => Number(c.testid.replace("racing-rider-", "")));
  if (hits.length < count) {
    throw new Error(`Need ${count} riders with ${spare} laps left, found ${hits.length}`);
  }
  return hits.slice(0, count);
}

/** Current left-to-right order of the racing grid, as bib numbers. */
async function boardOrder(page: Page): Promise<number[]> {
  return page
    .locator('[data-testid^="racing-rider-"]')
    .evaluateAll((els) =>
      els.map((el) => Number(((el as HTMLElement).dataset.testid ?? "").replace("racing-rider-", "")))
    );
}

/** Set the board hold from the live screen's settings gear, without leaving Live. */
async function setBoardHold(page: Page, seconds: number) {
  await page.getByRole("button", { name: "Live settings" }).click();
  await expect(page.getByRole("heading", { name: "Live Settings" })).toBeVisible();
  await page.getByLabel("Board hold").selectOption(String(seconds * 1000));
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Live Settings" })).toHaveCount(0);
}

test.describe("Lap recording core", () => {
  test("records a lap, blocks a second within 60s, and undoes cleanly", async ({ page }) => {
    await openLiveDemo(page);
    // Needs 2 spare laps: we record two and then undo one.
    const bib = await racingBibWithLapsLeft(page, 3);

    const lapsOf = async () =>
      (await card(page, bib).getAttribute("data-laps")) ?? "";
    const countOf = async () => Number((await lapsOf()).split("/")[0]);

    // ── Record a lap ────────────────────────────────────────────────────────
    const before = await countOf();
    await page.clock.fastForward(5 * 60 * 1000);
    await tap(page, bib);
    await expect(card(page, bib)).toHaveAttribute("data-laps", new RegExp(`^${before + 1}/`));

    // ── The 60 s minimum blocks an immediate second lap ──────────────────────
    // Only 30 s of simulated time passes, so the tap must be refused.
    await page.clock.fastForward(30 * 1000);
    await tap(page, bib);
    await expect(card(page, bib)).toHaveAttribute("data-laps", new RegExp(`^${before + 1}/`));
    // (The "Wait Ns" toast isn't asserted: react-toastify's entry animation
    // doesn't run under a frozen clock. The refused lap is the real contract.)

    // ── Past 60 s it is accepted again ───────────────────────────────────────
    await page.clock.fastForward(90 * 1000);
    await tap(page, bib);
    await expect(card(page, bib)).toHaveAttribute("data-laps", new RegExp(`^${before + 2}/`));

    // ── Undo restores the previous lap count ────────────────────────────────
    await card(page, bib).dblclick();
    await expect(page.getByText("Note / Comment")).toBeVisible();
    await page.getByRole("button", { name: /Revert Last Lap/ }).click();
    await expect(card(page, bib)).toHaveAttribute("data-laps", new RegExp(`^${before + 1}/`));
  });

  /**
   * Board hold: when a bunch arrives together the commissaire is reading bibs
   * off the board while a second person types them, so the cards must NOT move
   * one-by-one under them. Every tap restarts a board-wide countdown; only once
   * the arrivals stop do all the tapped cards drop to the bottom at once, in
   * tap order. Default hold is 2s (`stores/boardHoldStore.ts`).
   */
  test("board hold freezes the grid during a burst, then drops every tapped card at once", async ({ page }) => {
    await openLiveDemo(page);
    const [bibA, bibB] = await racingBibsWithLapsLeft(page, 2, 2);

    const orderBefore = await boardOrder(page);
    const lapsA = Number((await card(page, bibA).getAttribute("data-laps"))!.split("/")[0]);
    await page.clock.fastForward(5 * 60 * 1000);

    // ── Tap A. It counts immediately, but the card must stay put ─────────────
    await tap(page, bibA); // consumes 400ms of the 2s hold
    await expect(card(page, bibA)).toHaveAttribute("data-recorded", "true");
    // Only the POSITION is deferred — the lap itself lands at tap time.
    await expect(card(page, bibA)).toHaveAttribute("data-laps", new RegExp(`^${lapsA + 1}/`));
    expect(await boardOrder(page)).toEqual(orderBefore);

    // ── A second tap 1.5s later restarts the hold — still nothing moves ──────
    await page.clock.fastForward(1_100);
    await tap(page, bibB); // 1.9s since tap A, under the 2s hold
    await expect(card(page, bibB)).toHaveAttribute("data-recorded", "true");
    expect(await boardOrder(page)).toEqual(orderBefore);

    // ── Arrivals stop: both drop to the bottom together, in tap order ────────
    await page.clock.fastForward(2_100);
    await expect(card(page, bibA)).not.toHaveAttribute("data-recorded", "true");
    const rest = orderBefore.filter((b) => b !== bibA && b !== bibB);
    expect(await boardOrder(page)).toEqual([...rest, bibA, bibB]);
  });

  test("undo inside the hold cancels the pending move and clears the ✓", async ({ page }) => {
    await openLiveDemo(page);
    const bib = await racingBibWithLapsLeft(page, 2);

    const orderBefore = await boardOrder(page);
    await page.clock.fastForward(5 * 60 * 1000);
    await tap(page, bib);
    await expect(card(page, bib)).toHaveAttribute("data-recorded", "true");

    // Revert Last Lap while the card is still waiting to move.
    await card(page, bib).dblclick();
    await expect(page.getByText("Note / Comment")).toBeVisible();
    await page.getByRole("button", { name: /Revert Last Lap/ }).click();
    await expect(card(page, bib)).not.toHaveAttribute("data-recorded", "true");

    // The hold expiring must now move nothing at all.
    await page.clock.fastForward(3_000);
    expect(await boardOrder(page)).toEqual(orderBefore);
  });

  test("cancelling from the rider log inside the hold also cancels the pending move", async ({ page }) => {
    await openLiveDemo(page);
    const bib = await racingBibWithLapsLeft(page, 2);

    const orderBefore = await boardOrder(page);
    await page.clock.fastForward(5 * 60 * 1000);
    await tap(page, bib);
    await expect(card(page, bib)).toHaveAttribute("data-recorded", "true");

    // The log's per-entry cancel is a different undo path (`cancelAction`) than
    // Revert Last Lap, and has to drop the pending move too.
    await page.getByRole("button", { name: "View rider action history" }).click();
    await expect(page.getByRole("heading", { name: "Rider Log" })).toBeVisible();
    await page.getByTitle("Cancel this entry").first().click();
    await page.getByRole("button", { name: "Yes, Cancel" }).click();
    await page.getByRole("button", { name: "Close rider log" }).click();

    await expect(card(page, bib)).not.toHaveAttribute("data-recorded", "true");
    await page.clock.fastForward(3_000);
    expect(await boardOrder(page)).toEqual(orderBefore);
  });

  test("the live-screen gear changes the hold, and the new value applies straight away", async ({ page }) => {
    await openLiveDemo(page);
    await setBoardHold(page, 10);

    const bib = await racingBibWithLapsLeft(page, 2);
    const orderBefore = await boardOrder(page);
    await page.clock.fastForward(5 * 60 * 1000);
    await tap(page, bib);

    // 3s in: the 2s default would already have moved this card. 10s must not.
    await page.clock.fastForward(3_000);
    expect(await boardOrder(page)).toEqual(orderBefore);
    await expect(card(page, bib)).toHaveAttribute("data-recorded", "true");

    // Past 10s it drops, exactly as the shorter hold does.
    await page.clock.fastForward(8_000);
    expect(await boardOrder(page)).toEqual([...orderBefore.filter((b) => b !== bib), bib]);
  });

  test("max board hold flushes anyway, so a nonstop trickle can't freeze the board forever", async ({ page }) => {
    await openLiveDemo(page);
    // 10s hold ⇒ max hold = 3 × 10s = 30s, measured from the FIRST pending card.
    await setBoardHold(page, 10);

    const bibs = await racingBibsWithLapsLeft(page, 2, 4);
    const orderBefore = await boardOrder(page);
    await page.clock.fastForward(5 * 60 * 1000);

    // A tap every 9s keeps restarting the 10s hold — on its own this would hold
    // the board frozen for as long as riders keep trickling in. Note the gap
    // goes BEFORE each tap: a trailing one would carry us past the 30s max and
    // flush inside the loop.
    for (const [i, bib] of bibs.entries()) {
      if (i > 0) await page.clock.fastForward(8_600);
      await tap(page, bib); // consumes 400ms
      await expect(card(page, bib)).toHaveAttribute("data-recorded", "true");
    }
    // ~27.4s since the first tap: under the max, and the last tap was <1s ago.
    expect(await boardOrder(page)).toEqual(orderBefore);

    // Past 30s the safety valve fires even though taps are still arriving
    // inside the hold window.
    await page.clock.fastForward(3_000);
    const rest = orderBefore.filter((b) => !bibs.includes(b));
    expect(await boardOrder(page)).toEqual([...rest, ...bibs]);
  });

  test("the rider-log button sits in the timer row, aligned with the clock", async ({ page }) => {
    await openLiveDemo(page);
    // It used to be position:fixed at hand-tuned coordinates, so it drifted out
    // of the timer row whenever the header height changed.
    const logBtn = page.getByRole("button", { name: "View rider action history" });
    const clock = page.locator("p", { hasText: /^\d{2}:\d{2}:\d{2}$/ }).first();

    const btnBox = (await logBtn.boundingBox())!;
    const clockBox = (await clock.boundingBox())!;
    const btnMidY = btnBox.y + btnBox.height / 2;
    const clockMidY = clockBox.y + clockBox.height / 2;
    expect(Math.abs(btnMidY - clockMidY)).toBeLessThan(6);
    // ...and to the left of the clock, not floating over it.
    expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(clockBox.x);
  });

  test("DNF and DSQ move a rider out of the racing grid", async ({ page }) => {
    await openLiveDemo(page);

    const dnfBib = await anyRacingBib(page);
    await card(page, dnfBib).dblclick();
    await expect(page.getByText("Note / Comment")).toBeVisible();
    await page.getByRole("button", { name: "DNF", exact: true }).click();
    await expect(card(page, dnfBib)).toHaveCount(0);
    await expect(finished(page, dnfBib)).toHaveAttribute("data-status", "DNF");

    const dsqBib = await anyRacingBib(page);
    await card(page, dsqBib).dblclick();
    await expect(page.getByText("Note / Comment")).toBeVisible();
    await page.getByRole("button", { name: "DSQ", exact: true }).click();
    await expect(card(page, dsqBib)).toHaveCount(0);
    await expect(finished(page, dsqBib)).toHaveAttribute("data-status", "DSQ");
  });
});
