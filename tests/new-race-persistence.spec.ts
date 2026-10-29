import { createRequire } from "node:module";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { TERMS_VERSION } from "../src/app/legal/terms";
import { racingCard, gotoRaceMode } from "./helpers";

/**
 * A NEW race is persisted to PostgreSQL by itself, end to end through the app UI:
 * sign in → Create Race with a start list (synthetic riders) → the race is
 * uploaded with no extra step → a wave start is changed → wave 1 is started →
 * laps are recorded until riders finish → every step is in PostgreSQL → after a
 * reload the browser still shows it all.
 *
 * Opt-in (needs the API and its database): run the server (PGlite dev DB), run
 * the app with VITE_SERVER_URL=http://localhost:4000, then
 *   MULTIUSER_E2E=1 E2E_PG_URL=postgresql://... npx playwright test new-race-persistence
 * The database is only READ by this test.
 */
test.skip(!process.env.MULTIUSER_E2E, "needs a running Commissaire server (MULTIUSER_E2E=1)");
test.setTimeout(180_000);

const CSV_FIXTURE = path.resolve(__dirname, "fixtures", "full-race.csv");
const stamp = Date.now();
const RACE_NAME = `Persist E2E ${stamp}`;

/** Read-only query against the server's database (pg from the server package). */
async function pgQuery<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
  const url = process.env.E2E_PG_URL;
  if (!url) throw new Error("E2E_PG_URL is not set");
  const req = createRequire(path.resolve(__dirname, "..", "server", "package.json"));
  const { Client } = req("pg");
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows as T[];
  } finally {
    await c.end();
  }
}

const serverUuidOf = (page: Page, local: string) =>
  page.evaluate((l) => JSON.parse(localStorage.getItem("commissaire.live.links") ?? "{}")[l]?.serverRaceUuid ?? null, local);

const tap = async (page: Page, bib: number) => {
  await racingCard(page, bib).click();
  await page.waitForTimeout(600); // past the double-tap window
};

test("a new race, its waves, laps and finishes are saved to PostgreSQL and survive a reload", async ({ browser }) => {
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  await ctx.addInitScript((v) => localStorage.setItem("termsAcceptance", JSON.stringify({ version: v, acceptedAt: new Date().toISOString() })), TERMS_VERSION);
  const page = await ctx.newPage();

  await test.step("sign in", async () => {
    await page.goto("/account");
    await page.getByRole("button", { name: "New account" }).click();
    await page.getByPlaceholder("Your name").fill("Persist");
    await page.getByPlaceholder("Email").fill(`persist.${stamp}@x.test`);
    await page.getByPlaceholder("Password (8+ characters)").fill("password-persist");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("My shared races")).toBeVisible();
  });

  let local = "";
  await test.step("create the race with a start list — no Share step", async () => {
    await page.goto("/main");
    await page.getByRole("button", { name: /Create new race|^Add$/ }).first().click();
    await page.getByPlaceholder("Race Name").fill(RACE_NAME);
    await page.getByPlaceholder("Location").fill("Persist Circuit");
    await page.locator("#ridersFileUpload").setInputFiles(CSV_FIXTURE);
    await page.getByTestId("import-preview-confirm").check();
    await page.getByRole("button", { name: /Done|Saving/ }).click();
    await expect(page.getByText(RACE_NAME).first()).toBeVisible();
    await page.getByText(RACE_NAME).first().click();
    await page.waitForURL(/\/race\/[0-9a-f-]{36}$/);
    local = page.url().split("/race/")[1];
    await expect.poll(() => serverUuidOf(page, local), { timeout: 20_000 }).not.toBeNull();
    await page.reload();
    await expect(page.getByTestId("sync-badge")).toContainText("Synced", { timeout: 20_000 });
  });

  const server = async () => (await serverUuidOf(page, local)) as string;

  await test.step("race, categories and riders are in PostgreSQL", async () => {
    const id = await server();
    const [race] = await pgQuery<{ name: string }>(`select name from races where uuid = $1`, [id]);
    expect(race?.name).toBe(RACE_NAME);
    const [n] = await pgQuery<{ cats: number; riders: number }>(
      `select (select count(*)::int from categories where "raceUuid" = $1) cats, (select count(*)::int from riders where "raceUuid" = $1) riders`, [id]);
    expect(n).toEqual({ cats: 6, riders: 30 });
  });

  let movedCategory = "";
  await test.step("configure waves: a wave-2 start time changes, and the server has it", async () => {
    movedCategory = await page.evaluate(async (u) => {
      const cats = (await import("/src/app/stores/categoryStore.ts")).default;
      const races = (await import("/src/app/stores/racesStore.ts")).default;
      await cats.getState().getCategories(u);
      const c = cats.getState().categories.find((x) => x.raceUuid === u && x.heat === 2)!;
      await cats.getState().updateCategory({ ...c, startTime: "09:45" });
      // Race setting: no minimum lap time, so the test can record laps right away.
      const race = races.getState().races.find((r) => r.uuid === u)!;
      await races.getState().updateRace({ ...race, minLapSeconds: 0 });
      return c.name;
    }, local);
    const id = await server();
    await expect.poll(async () => (await pgQuery<{ startTime: string }>(
      `select "startTime" from categories where "raceUuid" = $1 and name = $2`, [id, movedCategory]))[0]?.startTime, { timeout: 15_000 }).toBe("09:45");
  });

  await test.step("check in wave 1 and start it on the Grid", async () => {
    await gotoRaceMode(page, "Race");
    await page.getByTestId("timeline-wave-1").click();
    await page.getByRole("button", { name: "Check-In", exact: true }).click();
    await page.getByTestId("checkin-tools").click(); // Check All sits in the Search/Sort panel
    const checkAll = page.getByRole("button", { name: /Check All/ });
    await checkAll.click();
    await expect(checkAll).toHaveCount(0);
    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await page.getByTestId("start-all").first().click();
    await expect(page.getByText(/RUNNING/).first()).toBeVisible();
  });

  await test.step("record laps until riders finish", async () => {
    await page.goto(`/race/${local}/heat/1`);
    await expect(racingCard(page, 1)).toBeVisible();
    await tap(page, 1); // 1/2
    await tap(page, 2); // 1/2
    await tap(page, 3); // 1/2
    await tap(page, 1); // 2/2 — first finish
    await tap(page, 2); // next crossing after the first finish: finished on 2/2
    await expect(racingCard(page, 1)).toHaveCount(0);
    await expect(racingCard(page, 2)).toHaveCount(0);
    await expect(page.getByTestId("sync-badge")).toContainText("Synced", { timeout: 20_000 });
  });

  await test.step("laps and finishes are in PostgreSQL", async () => {
    const id = await server();
    const riders = async () => pgQuery<{ bibNumber: number; lapsCounter: number; raceStatus: string; laps: number }>(
      `select "bibNumber", "lapsCounter", "raceStatus", jsonb_array_length(coalesce("lapsDetails"::jsonb, '[]'::jsonb))::int laps
         from riders where "raceUuid" = $1 and "bibNumber" = any($2) order by "bibNumber"`, [id, [1, 2, 3]]);
    await expect.poll(riders, { timeout: 15_000 }).toEqual([
      { bibNumber: 1, lapsCounter: 2, raceStatus: "finished", laps: 2 },
      { bibNumber: 2, lapsCounter: 2, raceStatus: "finished", laps: 2 },
      { bibNumber: 3, lapsCounter: 1, raceStatus: "running", laps: 1 },
    ]);
    const [ev] = await pgQuery<{ n: number }>(`select count(*)::int n from race_events where "raceUuid" = $1`, [id]);
    expect(ev.n).toBeGreaterThan(5);
  });

  await test.step("reload: the browser still has everything", async () => {
    await page.reload();
    await expect(racingCard(page, 3)).toBeVisible();
    await expect(racingCard(page, 3)).toHaveAttribute("data-laps", "1/2");
    await expect(racingCard(page, 1)).toHaveCount(0);
    const r = await page.evaluate(async (u) => {
      const riders = (await import("/src/app/stores/ridersStore.ts")).default;
      const all = await riders.getState().getRiders(u);
      return all.filter((x) => [1, 2].includes(x.bibNumber)).map((x) => [x.bibNumber, x.lapsCounter, x.raceStatus]);
    }, local);
    expect(r.sort()).toEqual([[1, 2, "finished"], [2, 2, "finished"]]);
  });

  await ctx.close();
});
