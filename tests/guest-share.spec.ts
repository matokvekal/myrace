import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Race Access Rules — guests (no account), PC and phone. The app is built with a
 * server URL (E2E_SERVER_URL, default http://localhost:4999) whose public API is
 * MOCKED here, so no server or database is touched:
 *  - signed out, race lists and management routes send you to sign in;
 *  - a shared race (/share/:token) is read-only: Info, Riders, Categories,
 *    Schedule, Board, Results — no edit, start, finish or live controls;
 *  - guest polling applies updates, then stops for good on 410 (window closed)
 *    or once the race is finished; an invalid or unpublished link says so.
 * Run: E2E_BASE_URL=<app built with VITE_SERVER_URL=E2E_SERVER_URL> npx playwright test tests/guest-share.spec.ts
 */
const SERVER = process.env.E2E_SERVER_URL ?? "http://localhost:4999";
const TOKEN = "AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB";

const race = (over: Record<string, unknown> = {}) => ({
  uuid: "472d3fa0-d2cd-47bf-8d79-7cba480fd0fc", name: "Guest Cup", date: "2026-11-04", time: "09:00", location: "Ben Shemen",
  status: "running", lastSeq: 5, orgenizer: "Club", raceType: "MTB", ...over,
});
const categories = [
  { uuid: "c1", raceUuid: "r", name: "Elite", subCategory: null, laps: 3, startTime: "09:00", heat: 1, status: "running", startedAt: 1, color: "#e53935", ignored: false, importOrder: 1 },
  { uuid: "c2", raceUuid: "r", name: "Kids", subCategory: null, laps: 1, startTime: "11:00", heat: 2, status: "upcoming", startedAt: null, color: "#1e88e5", ignored: false, importOrder: 2 },
];
const rider = (uuid: string, bib: number, last: string, cat: string, over: Record<string, unknown> = {}) => ({
  uuid, bibNumber: bib, firstName: "Test", lastName: last, category: cat, subCategory: null, team: "Team", status: "standing",
  raceStatus: cat === "Elite" ? "running" : "upcoming", lapsCounter: 1, position_category: null, elapsedTimeFromStart: "10:00", ...over,
});
const riders = [rider("r1", 11, "Alpha", "Elite", { position_category: 1, lapsCounter: 2 }), rider("r2", 12, "Beta", "Elite", { position_category: 2 }), rider("r3", 31, "Gamma", "Kids", { lapsCounter: 0 })];
const polling = (open = true) => ({ open, endsAt: open ? Date.now() + 3_600_000 : null, intervalMs: 1_000 });

async function mockRace(page: Page, opts: { finished?: boolean; changes?: ((n: number) => { status: number; body: unknown })[] } = {}) {
  const calls = { changes: 0, snapshot: 0 };
  // Registered FIRST (Playwright tries the latest route first). Anything else on the server would be a management call: a guest must never make one.
  const forbidden: string[] = [];
  await page.route(`${SERVER}/api/v1/**`, (r: Route) => {
    if (!r.request().url().includes("/api/v1/public/")) forbidden.push(r.request().url());
    return r.fulfill({ status: 401, json: { error: { code: "unauthorized" } } });
  });
  await page.route(`${SERVER}/api/v1/public/races/${TOKEN}`, (r: Route) => {
    calls.snapshot++;
    return r.fulfill({ json: { lastSeq: 5, serverTime: Date.now(), polling: polling(!opts.finished && calls.snapshot === 1), race: race(opts.finished ? { status: "finished" } : {}), categories, riders } });
  });
  await page.route(`${SERVER}/api/v1/public/races/${TOKEN}/changes*`, (r: Route) => {
    const step = opts.changes?.[calls.changes] ?? (() => ({ status: 410, body: { error: { code: "polling_closed", message: "ended" } } }));
    calls.changes++;
    const { status, body } = step(calls.changes);
    return r.fulfill({ status, json: body });
  });
  return { calls, forbidden };
}

for (const vp of [{ name: "PC", width: 1280, height: 860 }, { name: "phone", width: 390, height: 844 }]) {
  test.describe(`guest (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("race lists and management routes need an account", async ({ page }) => {
      for (const path of ["/main", "/race/some-race", "/race/some-race/heat/1"]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/account\?reason=guest/);
        await expect(page.getByTestId("signin-reason-guest")).toBeVisible();
      }
    });

    test("a shared race is read-only with every public tab, and polling stops on 410", async ({ page }) => {
      const { calls, forbidden } = await mockRace(page, {
        changes: [() => ({ status: 200, body: { lastSeq: 6, serverTime: Date.now(), polling: polling(), riders: [rider("r2", 12, "Beta", "Elite", { position_category: 1, lapsCounter: 3 })] } })],
      });
      await page.goto(`/share/${TOKEN}`);
      await expect(page.getByTestId("share-page")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Guest Cup" })).toBeVisible();
      for (const tab of ["info", "riders", "categories", "schedule", "board", "results"]) {
        await page.getByTestId(`share-tab-${tab}`).click();
        await expect(page.getByTestId(`share-tab-${tab}`)).toHaveAttribute("aria-selected", "true");
      }
      await page.getByTestId("share-tab-riders").click();
      await expect(page.getByText("Test Gamma")).toBeVisible();
      // Read-only: no management controls anywhere.
      for (const name of [/finish/i, /start/i, /edit/i, /delete/i, /check-?in/i, /save/i]) await expect(page.getByRole("button", { name })).toHaveCount(0);
      await expect(page.locator("input:not([placeholder^='Search'])")).toHaveCount(0);

      // One update arrives (Beta now leads with 3 laps), then the window closes (410) → final reload, polling ends.
      await page.getByTestId("share-tab-board").click();
      await expect(page.getByText("Lap 3/3")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId("share-live-state")).toHaveAttribute("data-live", "off", { timeout: 15_000 });
      await expect(page.getByTestId("share-live-state")).toContainText("Live updates ended");
      const after = calls.changes;
      await page.waitForTimeout(3_000);
      expect(calls.changes).toBe(after); // no polling after it closed
      expect(forbidden).toEqual([]);
    });

    test("a finished race shows final results and never polls", async ({ page }) => {
      const { calls } = await mockRace(page, { finished: true });
      await page.goto(`/share/${TOKEN}`);
      await expect(page.getByTestId("share-live-state")).toContainText("Final results");
      await page.waitForTimeout(2_500);
      expect(calls.changes).toBe(0);
    });

    test("an invalid or unpublished link says so", async ({ page }) => {
      await page.route(`${SERVER}/api/v1/public/races/**`, (r) => r.fulfill({ status: 404, json: { error: { code: "not_found", message: "This race link is not valid" } } }));
      await page.goto(`/share/${TOKEN}`);
      await expect(page.getByRole("alert")).toContainText("not valid");
    });
  });
}
