import { test, expect, type Page } from "@playwright/test";

/**
 * LIVE ranking motion in a real browser (real layout, real Web Animations): the public
 * API is MOCKED (same setup as guest-share.spec.ts), nothing on a server is touched.
 * A rider's new crossing arrives through Refresh (LIVE tab) or the 20 s poll (TV).
 */
const SERVER = process.env.E2E_SERVER_URL ?? "http://localhost:4999";
test.use({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001" });
const TOKEN = "AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB";

const T0 = Date.now() - 40 * 60_000;
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const rider = (uuid: string, bib: number, mins: number[], over: Record<string, unknown> = {}) => ({
  uuid, bibNumber: bib, firstName: "Test", lastName: `R${bib}`, category: "Elite", subCategory: null, status: "standing", raceStatus: "running",
  lapsCounter: mins.length, timeArrive: mins.length ? iso(mins[mins.length - 1]) : null, elapsedTimeFromStart: null, position_category: 0,
  lapsDetails: mins.map((m, i) => ({ lap: i + 1, startTime: iso(i ? mins[i - 1] : 0), endTime: iso(m), lapTime: "" })),
  ...over,
});
const field = () => Array.from({ length: 8 }, (_, i) => rider(`r${i}`, 100 + i, [10, 20 + i / 10]));
const categories = [{ uuid: "c1", raceUuid: "r", name: "Elite", subCategory: null, laps: 5, startTime: "09:00", heat: 1, status: "running", startedAt: T0, color: "#e53935", ignored: false, importOrder: 1 }];
const polling = { open: true, endsAt: Date.now() + 3_600_000, intervalMs: 10_000 };

async function mock(page: Page, updates: unknown[][]) {
  let n = 0;
  await page.route(`${SERVER}/api/v1/**`, (r) => r.fulfill({ status: 401, json: { error: { code: "unauthorized" } } }));
  await page.route(`${SERVER}/api/v1/public/races/${TOKEN}`, (r) =>
    r.fulfill({ json: { lastSeq: 5, serverTime: Date.now(), polling, race: { uuid: "R", name: "Motion Cup", date: new Date().toISOString().slice(0, 10), time: "00:00", location: "Ben Shemen", status: "running", lastSeq: 5 }, categories, riders: field() } }));
  await page.route(`${SERVER}/api/v1/public/races/${TOKEN}/changes*`, (r) => {
    const riders = updates[n++];
    return r.fulfill({ json: riders ? { lastSeq: 5 + n, serverTime: Date.now(), polling, riders } : { lastSeq: 5 + n, serverTime: Date.now(), polling, unchanged: true } });
  });
}

/** Web Animations started by useRankFlip on a row (CSS animations — the border — excluded). */
const flips = (page: Page, testId: string, bib: number) =>
  page.evaluate(([t, b]) => {
    const el = Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${t}"]`)).find((r) => r.getAttribute("aria-label")?.includes(`bib ${b}`));
    return (el?.getAnimations() ?? [])
      .filter((a) => !("animationName" in a))
      .map((a) => ({ first: String(((a.effect as KeyframeEffect).getKeyframes()[0] as Keyframe).transform), state: a.playState }));
  }, [testId, bib] as const);

for (const vp of [{ name: "PC", width: 1280, height: 860 }, { name: "phone", width: 390, height: 844 }]) {
  test.describe(`LIVE motion (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("a rider's new crossing: glides up with arrow + border; the rider passed glides down silently", async ({ page }) => {
      await mock(page, [[rider("r6", 106, [10, 20.6, 30])]]);
      await page.goto(`/share/${TOKEN}?tab=live`);
      await expect(page.getByTestId("live-row")).toHaveCount(8);
      await page.waitForTimeout(10_200); // manual Refresh is allowed 10 s after the last answer
      await page.getByTestId("share-refresh").click();
      const mover = page.getByTestId("live-row").first();
      await expect(mover).toHaveAttribute("aria-label", /^Position 1, bib 106/);
      await expect(mover).toHaveAttribute("data-motion", "gain");
      await expect(mover.locator('[data-trend="up"]')).toHaveText("▲6");
      const up = await flips(page, "live-row", 106);
      expect(up[0]?.first).toMatch(/^translateY\(\d+(\.\d+)?px\)$/); // starts below its new row
      const passed = await flips(page, "live-row", 100);
      expect(passed[0]?.first).toMatch(/^translateY\(-\d/); // pushed down one row
      await expect(page.getByTestId("live-row").nth(1)).not.toHaveAttribute("data-motion", /.+/);
      await page.waitForTimeout(2_200);
      expect(await flips(page, "live-row", 106)).toEqual([]); // finished, nothing left mid-air
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
    });

    test("DNF slides out and stays in the DNF · DSQ · DNS section; reduced motion = no movement", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await mock(page, [[rider("r0", 100, [10, 20], { status: "DNF" })]]);
      await page.goto(`/share/${TOKEN}?tab=live`);
      await expect(page.getByTestId("live-row")).toHaveCount(8);
      await page.waitForTimeout(10_200);
      await page.getByTestId("share-refresh").click();
      const out = page.getByTestId("live-row").last();
      await expect(out).toHaveAttribute("aria-label", /^DNF, bib 100/);
      await expect(out).toHaveAttribute("data-motion", "out");
      expect((await flips(page, "live-row", 100))[0]?.first).toMatch(/^translate\(0(px)?, -?\d/);
      await expect(page.getByText("DNF · DSQ · DNS")).toBeVisible();
    });

    test("prefers-reduced-motion: positions and arrow update, nothing moves", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await mock(page, [[rider("r6", 106, [10, 20.6, 30])]]);
      await page.goto(`/share/${TOKEN}?tab=live`);
      await expect(page.getByTestId("live-row")).toHaveCount(8);
      await page.waitForTimeout(10_200);
      await page.getByTestId("share-refresh").click();
      await expect(page.getByTestId("live-row").first()).toHaveAttribute("aria-label", /^Position 1, bib 106/);
      expect(await flips(page, "live-row", 106)).toEqual([]);
    });
  });
}

test("TV broadcast: the mover glides on the board, no page scroll, rows never doubled", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await mock(page, [[rider("r6", 106, [10, 20.6, 30])]]);
  await page.goto(`/share/${TOKEN}?tab=live&view=tv`);
  await expect(page.getByTestId("tv-row").first()).toBeVisible();
  const before = await page.getByTestId("tv-row").count();
  await expect(page.getByTestId("tv-row").first()).toHaveAttribute("aria-label", /^Position 1, bib 106/, { timeout: 25_000 }); // the 20 s LIVE poll
  await expect(page.getByTestId("tv-row").first()).toHaveAttribute("data-motion", "gain");
  expect((await flips(page, "tv-row", 106))[0]?.first).toMatch(/^translateY\(\d/);
  expect(await page.getByTestId("tv-row").count()).toBe(before);
  const overflow = await page.evaluate(() => ({ x: document.documentElement.scrollWidth > window.innerWidth, y: document.documentElement.scrollHeight > window.innerHeight }));
  expect(overflow).toEqual({ x: false, y: false });
});
