import { expect, Page, Locator } from "@playwright/test";
import { TERMS_VERSION } from "../src/app/legal/terms";

/** Number of riders the demo race seeds (40 across 8 categories / 2 waves). */
export const DEMO_RIDER_COUNT = 40;

/**
 * Load the built-in demo race. Each Playwright test gets a fresh browser
 * context (empty IndexedDB), so /main always offers the "Try Demo Race" button
 * and the seed navigates to /race/demo-race-99001.
 */
/**
 * Accept the Terms & Conditions. The app no longer blocks at startup — instead
 * acceptance is a checkbox on the landing page that gates its "Press Start" CTA.
 * Every test runs a fresh profile, so we seed the same persisted acceptance
 * record the checkbox would write (harmless for tests that jump straight to
 * /main and bypass the landing CTA).
 */
export async function acceptTerms(page: Page): Promise<void> {
  await page.evaluate((version) => {
    localStorage.setItem(
      "termsAcceptance",
      JSON.stringify({ version, acceptedAt: new Date().toISOString() })
    );
  }, TERMS_VERSION);
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
      await gotoRaceMode(page, "Create");
    }
    // The race tab bar is up once the Riders tab button is present.
    await expect(page.getByRole("button", { name: "Riders", exact: true })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
}

/** Switch race mode through the race sidebar (hamburger → Create / Race / Live / Results / Board). */
export async function gotoRaceMode(page: Page, mode: "Create" | "Race" | "Live" | "Results" | "Board"): Promise<void> {
  const key = ({ Create: "setup", Race: "race", Live: "live", Results: "results", Board: "board" } as const)[mode];
  // An open wave sheet dims the whole screen: tap outside to close it first.
  const backdrop = page.getByTestId("sheet-backdrop");
  if (await backdrop.isVisible().catch(() => false)) {
    await backdrop.click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId("wave-sheet")).toHaveCount(0);
  }
  await page.getByTestId("race-menu-btn").click();
  await page.getByTestId(`race-nav-${key}`).click();
  // Race opens on the full timeline; open the current wave's bottom sheet.
  if (key === "race") {
    const panel = page.getByTestId("wave-sheet");
    if (!(await panel.isVisible().catch(() => false))) {
      const current = page.locator('[data-testid^="timeline-wave-"][data-current="true"]');
      await ((await current.count()) ? current.first() : page.locator('[data-testid^="timeline-wave-"]').first()).click();
      await panel.waitFor();
    }
  }
}

/**
 * Open a Race-screen view: "Grid" = the start screen inside the wave bottom
 * sheet; "Check-In" opens Check-In there; Board is its own race mode (sidebar).
 */
export async function openRaceView(page: Page, view: "Grid" | "Check-In" | "Board"): Promise<void> {
  if (view === "Board") return gotoRaceMode(page, "Board");
  const sheet = page.getByTestId("wave-sheet");
  if (!(await sheet.isVisible().catch(() => false))) await gotoRaceMode(page, "Race");
  const back = sheet.getByRole("button", { name: "Back to wave" });
  if (await back.isVisible().catch(() => false)) await back.click();
  if (view === "Check-In") await page.getByTestId("sheet-checkin").click();
  else await page.getByTestId("sheet-start").waitFor();
}

/** Open a top-level race tab (Schedule / Categories / Riders / Results / …). */
export async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
}

/** Pick a wave in race mode: its card on the race-day timeline. */
export async function selectWave(page: Page, wave: number): Promise<void> {
  // The Board screen picks its wave from a dropdown.
  const boardWave = page.getByTestId("board-wave");
  if (await boardWave.isVisible().catch(() => false)) {
    await boardWave.selectOption(String(wave));
    return;
  }
  // An open bottom sheet dims the timeline: tap outside to close it first.
  const backdrop = page.getByTestId("sheet-backdrop");
  if (await backdrop.isVisible().catch(() => false)) {
    await backdrop.click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId("wave-sheet")).toHaveCount(0);
  }
  await page.getByTestId(`timeline-wave-${wave}`).click();
}

// ─── Live/heat helpers (hoisted from joker.spec.ts / lap-recording.spec.ts /
// full-race-e2e.spec.ts — see tests/AGENT.md for the shared-helper rule) ──────

/** A racing rider's card on the Live grid, keyed by bib (`data-testid="racing-rider-<bib>"`). */
export function racingCard(page: Page, bib: number): Locator {
  return page.locator(`[data-testid="racing-rider-${bib}"]`);
}

/** A finished rider's card on the Live grid, keyed by bib (`data-testid="finish-rider-<bib>"`). */
export function finishedCard(page: Page, bib: number): Locator {
  return page.locator(`[data-testid="finish-rider-${bib}"]`);
}

/**
 * Tap a racing rider's card once and let the fake clock clear the 300ms
 * single/double-tap disambiguation window. Requires `page.clock.install(...)`
 * to already be active.
 */
export async function tapWithSettle(page: Page, bib: number): Promise<void> {
  await racingCard(page, bib).click();
  await page.clock.fastForward(400);
}

/**
 * Load the demo race and land on the Live/heat screen with racing cards
 * visible. Does NOT install the fake clock — install it before calling this
 * if the test needs deterministic timing (lap debounce, tap settle, etc.).
 */
export async function openLiveDemo(page: Page): Promise<void> {
  await page.goto("/main");
  await acceptTerms(page);
  await page.getByRole("button", { name: /Try Demo Race/i }).click();
  await page.waitForURL(/\/race\/demo-race-99001/);
  // The demo's one-shot onboarding lands us on Live; make sure we're there.
  await expect(async () => {
    if (!/\/heat\//.test(page.url())) {
      await gotoRaceMode(page, "Live");
    }
    await expect(page.locator('[data-testid^="racing-rider-"]').first()).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
}

/**
 * Find a racing bib with at least `spare` laps still to run, so taps record
 * laps instead of finishing the rider and removing their card.
 */
export async function racingBibWithLapsLeft(page: Page, spare: number): Promise<number> {
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

/** A rider's row on the Check-In list (`data-testid="checkin-row-<bib>"`). */
export function checkInRow(page: Page, bib: number): Locator {
  return page.getByTestId(`checkin-row-${bib}`);
}

/** Change a rider's status via the check-in row's Status menu. */
export async function setStatusAtCheckIn(
  page: Page,
  bib: number,
  status: "DNS" | "DNF" | "DSQ"
): Promise<void> {
  const row = checkInRow(page, bib);
  await row.getByRole("button", { name: "Status" }).click();
  // Scoped to the modal — the row itself also carries a one-tap DNS button, so
  // a bare getByText("DNS") is ambiguous.
  const modal = page.locator('[class*="modalbottom"]').first();
  await expect(modal).toBeVisible();
  await modal.getByText(status, { exact: true }).click();
  await expect(row.getByRole("button", { name: status })).toBeVisible();
}
