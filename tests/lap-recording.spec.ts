import { test, expect, Page } from "@playwright/test";
import { acceptTerms } from "./helpers";

/**
 * Safety net for the lap-recording core on the Live screen — the highest-risk
 * code in the app, and the part task 29 extracts into a hook. These assert the
 * behaviour that must survive that refactor unchanged.
 *
 * Uses the demo race, which seeds mid-race with wave 1 already on course, and a
 * fake clock (the 60 s minimum between laps and the 300 ms tap-disambiguation
 * timer both make real time unusable — see the full-race spec).
 */

const card = (page: Page, bib: number) => page.locator(`[data-testid="racing-rider-${bib}"]`);
const finished = (page: Page, bib: number) => page.locator(`[data-testid="finish-rider-${bib}"]`);

/** Tap once and let the fake clock clear the single/double-tap window. */
async function tap(page: Page, bib: number) {
  await card(page, bib).click();
  await page.clock.fastForward(400);
}

async function openLiveDemo(page: Page) {
  await page.clock.install({ time: new Date("2026-07-21T09:00:00") });
  await page.goto("/main");
  await acceptTerms(page);
  await page.getByRole("button", { name: /Try Demo Race/i }).click();
  await page.waitForURL(/\/race\/demo-race-99001/);
  // The demo's one-shot onboarding lands us on Live; make sure we're there.
  await expect(async () => {
    if (!/\/heat\//.test(page.url())) {
      await page.getByRole("tab", { name: "Live", exact: true }).click();
    }
    await expect(page.locator('[data-testid^="racing-rider-"]').first()).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
}

/** Any bib currently racing. */
async function anyRacingBib(page: Page): Promise<number> {
  const id = await page
    .locator('[data-testid^="racing-rider-"]')
    .first()
    .getAttribute("data-testid");
  return Number(id!.replace("racing-rider-", ""));
}

/**
 * A bib with at least `spare` laps still to run — so the taps below record laps
 * instead of finishing the rider and removing their card. The demo seeds
 * mid-race, and its leader is on his last lap.
 */
async function racingBibWithLapsLeft(page: Page, spare: number): Promise<number> {
  const cards = await page
    .locator('[data-testid^="racing-rider-"]')
    .evaluateAll((els) =>
      els.map((el) => {
        const e = el as HTMLElement;
        return { testid: e.dataset.testid ?? "", laps: e.dataset.laps ?? "" };
      })
    );
  for (const c of cards) {
    const [done, total] = c.laps.split("/").map(Number);
    if (Number.isFinite(done) && Number.isFinite(total) && total - done >= spare) {
      return Number(c.testid.replace("racing-rider-", ""));
    }
  }
  throw new Error(`No racing rider with ${spare} laps left. Cards: ${JSON.stringify(cards)}`);
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
