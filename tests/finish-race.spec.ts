import { test, expect, Page } from "@playwright/test";
import { loadDemoRace, openTab } from "./helpers";

/**
 * "Finish Race" (Info tab) closes a race for good: every rider is classified,
 * every category closed, a SHA-256 record is stamped on the race, and from then
 * on the race is read-only.
 *
 * The lock is enforced in the stores, not only in the UI, so these tests check
 * BOTH halves — that the controls disappear, and that a direct store write is
 * refused even when the UI is bypassed entirely.
 */

/** Walk the Info tab's Finish Race flow through the typed confirmation. */
async function finishRace(page: Page): Promise<void> {
  await openTab(page, "Info");
  const btn = page.getByTestId("finish-race-btn");
  await btn.scrollIntoViewIfNeeded();
  await btn.click();

  const modal = page.getByTestId("finish-race-modal");
  await expect(modal).toBeVisible();

  const confirm = page.getByTestId("finish-race-confirm");
  // Guard rail: the confirm button stays dead until the word is typed exactly.
  await expect(confirm).toBeDisabled();
  await page.locator("#finish-race-input").fill("FINISH");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByTestId("race-certificate")).toBeVisible();
}

/** Read one race straight out of the Zustand store, bypassing the UI. */
async function readRace(page: Page, uuid: string) {
  return page.evaluate(async (raceUuid) => {
    const mod = await import("/src/app/stores/racesStore.ts");
    const store = (mod.default as any).getState();
    const race = store.races.find((r: any) => r.uuid === raceUuid);
    return race
      ? { status: race.status, finalized: race.finalized ?? null, name: race.name }
      : null;
  }, uuid);
}

const DEMO_UUID = "demo-race-99001";

test.describe("Finish Race", () => {
  test("closes every rider and category, then locks the race", async ({ page }) => {
    await loadDemoRace(page);

    // The demo seeds mid-race — riders are on the road and categories are open,
    // which is exactly the state finalizing has to clean up.
    const before = await page.evaluate(async (raceUuid) => {
      const riderMod = await import("/src/app/stores/ridersStore.ts");
      const catMod = await import("/src/app/stores/categoryStore.ts");
      const riders = (riderMod.default as any)
        .getState()
        .riders.filter((r: any) => r.raceUuid === raceUuid);
      const cats = (catMod.default as any)
        .getState()
        .categories.filter((c: any) => c.raceUuid === raceUuid);
      return {
        total: riders.length,
        stillRunning: riders.filter((r: any) => r.raceStatus === "running").length,
        openCats: cats.filter((c: any) => c.status !== "finished").length,
      };
    }, DEMO_UUID);

    expect(before.total).toBeGreaterThan(0);
    expect(before.stillRunning).toBeGreaterThan(0);

    // The modal must surface that riders are still on course BEFORE confirming.
    await openTab(page, "Info");
    await page.getByTestId("finish-race-btn").scrollIntoViewIfNeeded();
    await page.getByTestId("finish-race-btn").click();
    await expect(page.getByTestId("finish-race-onroad-warning")).toBeVisible();
    await page.locator("#finish-race-input").fill("FINISH");
    await page.getByTestId("finish-race-confirm").click();
    await expect(page.getByTestId("race-certificate")).toBeVisible();

    const after = await page.evaluate(async (raceUuid) => {
      const riderMod = await import("/src/app/stores/ridersStore.ts");
      const catMod = await import("/src/app/stores/categoryStore.ts");
      const riders = (riderMod.default as any)
        .getState()
        .riders.filter((r: any) => r.raceUuid === raceUuid);
      const cats = (catMod.default as any)
        .getState()
        .categories.filter((c: any) => c.raceUuid === raceUuid);
      return {
        total: riders.length,
        stillRunning: riders.filter((r: any) => r.raceStatus === "running").length,
        openCats: cats.filter((c: any) => c.status !== "finished").length,
        withoutPlacing: riders.filter(
          (r: any) =>
            !["DNF", "DSQ", "DNS"].includes(r.status) && !(r.position_category > 0)
        ).length,
        // A rider still on the road is credited as a FINISHER on the laps they
        // completed — never silently converted into a DNF.
        inventedDnf: riders.filter((r: any) => r.status === "DNF").length,
      };
    }, DEMO_UUID);

    expect(after.total).toBe(before.total);
    expect(after.stillRunning).toBe(0);
    expect(after.openCats).toBe(0);
    expect(after.withoutPlacing).toBe(0);

    const race = await readRace(page, DEMO_UUID);
    expect(race?.status).toBe("finished");
    expect(race?.finalized?.algo).toBe("SHA-256");
    expect(race?.finalized?.token).toMatch(/^[0-9a-f]{64}$/);
    expect(race?.finalized?.riderCount).toBe(before.total);

    // The certificate re-verifies the signature against the stored riders.
    await expect(page.getByTestId("race-certificate")).toHaveAttribute(
      "data-check",
      "valid"
    );
  });

  test("hides live timing, setup tabs and every edit control", async ({ page }) => {
    await loadDemoRace(page);
    await finishRace(page);

    // The Setup/Start/Live switcher collapses to a seal — no phase left to enter.
    await expect(page.getByTestId("phase-final")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Live", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Start", exact: true })).toHaveCount(0);

    // Setup-only tabs are gone; results-facing ones stay.
    await expect(page.getByRole("button", { name: "Schedule", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Categories", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Results", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Riders", exact: true })).toBeVisible();

    await expect(page.getByTestId("race-final-banner")).toBeVisible();

    // Info: race details locked, import gone, export + verify still available.
    await openTab(page, "Info");
    await expect(page.getByTestId("info-locked-note")).toBeVisible();
    await expect(page.getByRole("button", { name: /Edit Race Info/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Import from Excel/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Export to Excel/i })).toBeVisible();
    // Finishing twice is not a thing.
    await expect(page.getByTestId("finish-race-btn")).toHaveCount(0);

    // Riders: no Actions menu (import / edit) and no Delete All.
    await openTab(page, "Riders");
    await expect(page.getByRole("button", { name: /Actions/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Delete All/i })).toHaveCount(0);
  });

  test("bounces the Live screen even when reached by direct URL", async ({ page }) => {
    await loadDemoRace(page);
    await finishRace(page);

    await page.goto(`/race/${DEMO_UUID}/heat/1`);
    await page.waitForURL(new RegExp(`/race/${DEMO_UUID}$`));
    await expect(page.getByTestId("race-final-banner")).toBeVisible();
  });

  test("refuses rider, category and race writes at the store level", async ({ page }) => {
    await loadDemoRace(page);
    await finishRace(page);

    // Bypass the UI entirely — this is what the store guards exist for.
    const result = await page.evaluate(async (raceUuid) => {
      const riderMod = await import("/src/app/stores/ridersStore.ts");
      const catMod = await import("/src/app/stores/categoryStore.ts");
      const raceMod = await import("/src/app/stores/racesStore.ts");
      const riderStore = (riderMod.default as any).getState();
      const catStore = (catMod.default as any).getState();
      const raceStore = (raceMod.default as any).getState();

      const rider = riderStore.riders.find((r: any) => r.raceUuid === raceUuid);
      const cat = catStore.categories.find((c: any) => c.raceUuid === raceUuid);
      const race = raceStore.races.find((r: any) => r.uuid === raceUuid);

      await riderStore.updateRider({ ...rider, lapsCounter: 999, status: "DSQ" });
      await riderStore.patchRiders([{ ...rider, bibNumber: 4242 }]);
      await riderStore.addNewRider({ ...rider, id: 987654321, bibNumber: 777 });
      await catStore.updateCategory({ ...cat, laps: 99, status: "running" });
      await raceStore.updateRace({ ...race, name: "Renamed after the fact" });
      // Allowed: a favourite star says nothing about the result.
      await raceStore.updateRace({ ...race, isFavorite: true });

      const riderNow = (riderMod.default as any)
        .getState()
        .riders.find((r: any) => r.id === rider.id);
      const catNow = (catMod.default as any)
        .getState()
        .categories.find((c: any) => c.id === cat.id);
      const raceNow = (raceMod.default as any)
        .getState()
        .races.find((r: any) => r.uuid === raceUuid);

      return {
        laps: riderNow.lapsCounter,
        status: riderNow.status,
        bib: riderNow.bibNumber,
        originalBib: rider.bibNumber,
        added: (riderMod.default as any)
          .getState()
          .riders.some((r: any) => r.id === 987654321),
        catLaps: catNow.laps,
        catStatus: catNow.status,
        raceName: raceNow.name,
        originalName: race.name,
        favorite: Boolean(raceNow.isFavorite),
      };
    }, DEMO_UUID);

    expect(result.laps).not.toBe(999);
    expect(result.status).not.toBe("DSQ");
    expect(result.bib).toBe(result.originalBib);
    expect(result.added).toBe(false);
    expect(result.catLaps).not.toBe(99);
    expect(result.catStatus).toBe("finished");
    expect(result.raceName).toBe(result.originalName);
    // The allowlisted field still moves — the lock is targeted, not a blanket ban.
    expect(result.favorite).toBe(true);
  });

  test("survives a reload — the lock is persisted, not just in memory", async ({ page }) => {
    await loadDemoRace(page);
    await finishRace(page);

    await page.reload();
    await page.waitForURL(new RegExp(`/race/${DEMO_UUID}`));

    await expect(page.getByTestId("race-final-banner")).toBeVisible();
    const race = await readRace(page, DEMO_UUID);
    expect(race?.finalized?.token).toMatch(/^[0-9a-f]{64}$/);
  });

  test("detects results altered behind the signature's back", async ({ page }) => {
    await loadDemoRace(page);
    await finishRace(page);

    await openTab(page, "Info");
    await expect(page.getByTestId("race-certificate")).toHaveAttribute(
      "data-check",
      "valid"
    );

    // Write straight into the Zustand array, skipping the guarded actions — the
    // kind of damage a rogue script or a hand-edited IDB could do. The
    // certificate must call it out rather than keep claiming to be official.
    await page.evaluate(async (raceUuid) => {
      const mod = await import("/src/app/stores/ridersStore.ts");
      const store = mod.default as any;
      store.setState((s: any) => ({
        riders: s.riders.map((r: any) =>
          r.raceUuid === raceUuid && r.position_category === 1
            ? { ...r, position_category: 7 }
            : r
        ),
      }));
    }, DEMO_UUID);

    await expect(page.getByTestId("race-certificate")).toHaveAttribute(
      "data-check",
      "results-modified"
    );
  });

  // Both /main views carry the badge — the tile grid (home) and the race-card
  // list — under one testid, so this passes whichever the user last chose.
  test("shows the locked Final badge on the race list", async ({ page }) => {
    await loadDemoRace(page);
    await finishRace(page);

    await page.goto("/main");
    await expect(page.getByTestId("race-final-badge").first()).toBeVisible();
  });
});
