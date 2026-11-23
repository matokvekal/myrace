import { test, expect, type Page } from "@playwright/test";

/**
 * Hotfix 2026-11-23 — public LIVE in a real browser (public API MOCKED, nothing on a server is
 * touched): automatic 10 s refresh (also for a race dated days ago while a wave runs), tracking
 * star (LIVE only, ranking unchanged, kept across reload), scroll position stable during updates.
 */
const SERVER = process.env.E2E_SERVER_URL ?? "http://localhost:4999";
test.use({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001" });
const TOKEN = "AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB";
const N = 60;

const T0 = Date.now() - 40 * 60_000;
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const rider = (i: number, mins: number[]) => ({
  uuid: `r${i}`, bibNumber: 100 + i, firstName: "Test", lastName: `R${100 + i}`, category: "Elite", subCategory: null, status: "standing",
  raceStatus: "running", lapsCounter: mins.length, timeArrive: mins.length ? iso(mins[mins.length - 1]) : null, elapsedTimeFromStart: null,
  position_category: 0, lapsDetails: mins.map((m, k) => ({ lap: k + 1, startTime: iso(k ? mins[k - 1] : 0), endTime: iso(m), lapTime: "" })),
});
// Rider i is in position i + 1 (lap 2 at 20 min + i seconds).
const field = () => Array.from({ length: N }, (_, i) => rider(i, [10, 20 + i / 60]));
const categories = [{ uuid: "c1", raceUuid: "r", name: "Elite", subCategory: null, laps: 5, startTime: "09:00", heat: 1, status: "running", startedAt: T0, color: "#e53935", ignored: false, importOrder: 1 }];
const polling = { open: true, endsAt: Date.now() + 3_600_000, intervalMs: 10_000 };
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);

/** Each /changes answer takes the next update (rider lists); afterwards "unchanged". */
async function mock(page: Page, updates: unknown[][]) {
  const calls: number[] = [];
  await page.route(`${SERVER}/api/v1/**`, (r) => r.fulfill({ status: 401, json: { error: { code: "unauthorized" } } }));
  await page.route(`${SERVER}/api/v1/public/races/${TOKEN}`, (r) =>
    r.fulfill({ json: { lastSeq: 5, serverTime: Date.now(), polling, race: { uuid: "R", name: "Tracking Cup", date: daysAgo(5), time: "09:00", location: "Ben Shemen", status: "running", lastSeq: 5 }, categories, riders: field() } }));
  await page.route(`${SERVER}/api/v1/public/races/${TOKEN}/changes*`, (r) => {
    calls.push(Date.now());
    const riders = updates[calls.length - 1];
    return r.fulfill({ json: riders ? { lastSeq: 5 + calls.length, serverTime: Date.now(), polling, riders } : { lastSeq: 5 + calls.length, serverTime: Date.now(), polling, unchanged: true } });
  });
  return calls;
}

const order = (page: Page) => page.getByTestId("live-row").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-uuid")));
const rowOf = (page: Page, uuid: string) => page.locator(`[data-testid="live-row"][data-uuid="${uuid}"]`);
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

for (const vp of [{ name: "PC", width: 1280, height: 860 }, { name: "phone", width: 390, height: 844 }]) {
  test.describe(`LIVE tracking (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("auto refresh (race dated 5 days ago), stars keep order and follow riders, scroll stays put, reload keeps stars", async ({ page }) => {
      test.setTimeout(90_000);
      // Update 1: r50 (position 51) takes the lead; update 2: r55 too.
      const calls = await mock(page, [[rider(50, [10, 19, 28])], [rider(55, [10, 19, 27])]]);
      await page.goto(`/share/${TOKEN}?tab=live`);
      await expect(page.getByTestId("live-row")).toHaveCount(N);
      const before = await order(page);

      // Star 3 riders: ranking unchanged, star filled, row highlighted.
      for (const u of ["r3", "r30", "r50"]) await rowOf(page, u).getByTestId("share-star").click();
      expect(await order(page)).toEqual(before);
      await expect(page.locator('[data-testid="live-row"][data-fav="true"]')).toHaveCount(3);
      await expect(rowOf(page, "r30").getByTestId("share-star")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("my-riders")).toHaveCount(0);

      // Scroll to the middle of the standings, then let the automatic poll arrive.
      await rowOf(page, "r30").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 200));
      const y0 = await scrollY(page);
      expect(y0).toBeGreaterThan(300);
      await expect(rowOf(page, "r50")).toHaveAttribute("aria-label", /^Position 1, bib 150/, { timeout: 15_000 });
      expect(calls.length).toBe(1);
      await page.waitForTimeout(1_500); // glide finished
      expect(Math.abs((await scrollY(page)) - y0)).toBeLessThanOrEqual(1);
      await expect(rowOf(page, "r50")).toHaveAttribute("data-fav", "true"); // the star followed the rider
      await expect(rowOf(page, "r49")).not.toHaveAttribute("data-fav", "true");

      // The next update arrives while the spectator is scrolling with the wheel: no jump.
      const y1 = await scrollY(page);
      let wheeled = 0;
      while (calls.length < 2) {
        await page.mouse.move(vp.width / 2, vp.height / 2);
        await page.mouse.wheel(0, 20);
        wheeled += 20;
        await page.waitForTimeout(250);
        expect(wheeled).toBeLessThan(2_000);
      }
      await page.waitForTimeout(1_500);
      await expect(rowOf(page, "r55")).toHaveAttribute("aria-label", /^Position 1, bib 155/);
      expect(Math.abs((await scrollY(page)) - (y1 + wheeled))).toBeLessThanOrEqual(2);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);

      // Reload keeps the stars (this link, this browser).
      await page.reload();
      await expect(page.getByTestId("live-row")).toHaveCount(N);
      await expect(page.locator('[data-testid="live-row"][data-fav="true"]')).toHaveCount(3);
    });

    test("TV mode has no tracking controls", async ({ page }) => {
      await mock(page, []);
      await page.addInitScript((t) => localStorage.setItem(`commissaire.myRiders.v1.${t}`, JSON.stringify(["r0"])), TOKEN);
      await page.goto(`/share/${TOKEN}?tab=live&view=tv`);
      await expect(page.getByTestId("tv-row").first()).toBeVisible();
      await expect(page.getByTestId("share-star")).toHaveCount(0);
    });
  });
}
