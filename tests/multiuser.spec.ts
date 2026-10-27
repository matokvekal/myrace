import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { TERMS_VERSION } from "../src/app/legal/terms";
import { racingCard } from "./helpers";

/**
 * Multi-user race, end to end through the real app UI, with two independently
 * signed-in users in separate browsers against a running Commissaire server:
 *
 *   Owner (A) signs up, shares a local race from the Team tab and creates a
 *   counter invitation for wave 1 (link + QR). Counter (B) signs up, accepts.
 *   A starts wave 1 on the Grid; both see it. B taps laps on Live — A sees
 *   them; A taps — B sees them. Joker on B lands on A. Undo on B is undone on A.
 *   B never sees wave 2. Offline taps on B arrive after reconnect.
 *
 * Opt-in (needs the API): start `server` (npm run db:dev + npm run dev), run the
 * app with VITE_SERVER_URL=http://127.0.0.1:4000, then MULTIUSER_E2E=1 npx playwright test multiuser.
 */
test.skip(!process.env.MULTIUSER_E2E, "needs a running Commissaire server (MULTIUSER_E2E=1)");
test.setTimeout(240_000);

const stamp = Date.now();
const WAVE1 = [301, 302, 303, 304];
const WAVE2 = [401, 402];

async function newUserPage(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  await ctx.addInitScript((v) => localStorage.setItem("termsAcceptance", JSON.stringify({ version: v, acceptedAt: new Date().toISOString() })), TERMS_VERSION);
  return { ctx, page: await ctx.newPage() };
}

async function signUp(page: Page, name: string) {
  await page.goto("/account");
  await page.getByRole("button", { name: "New account" }).click();
  await page.getByPlaceholder("Your name").fill(name);
  await page.getByPlaceholder("Email").fill(`${name.toLowerCase()}.${stamp}@x.test`);
  await page.getByPlaceholder("Password (8+ characters)").fill(`password-${name}`);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("My shared races")).toBeVisible();
}

/** A local race made through the app's own stores (synthetic riders, checked in). */
async function seedLocalRace(page: Page, raceName = "Shared E2E Race"): Promise<string> {
  await page.goto("/main");
  return page.evaluate(async ({ w1, w2, raceName }) => {
    const races = (await import("/src/app/stores/racesStore.ts")).default;
    const cats = (await import("/src/app/stores/categoryStore.ts")).default;
    const riders = (await import("/src/app/stores/ridersStore.ts")).default;
    const uuid = crypto.randomUUID();
    await races.getState().insertRace({ id: Date.now(), uuid, owner: "Owner", name: raceName, location: "Park", time: "09:00", date: "2026-10-27",
      image: "", heat: "", type: "", level: "", orgenizer: "", manager: "", phone: "", takanon: "", site: "", map: "", distance: 0, isActive: true,
      createdAt: new Date(), lastUpdateAt: new Date() } as never);
    await cats.getState().upsertCategories([
      { id: Date.now() + 1, raceUuid: uuid, name: "Elite", subCategory: null, laps: 5, lapsCounter: 0, riders: w1.length, startTime: "09:00", isConnected: false, color: "#d33", heat: 1, status: "upcoming" },
      { id: Date.now() + 2, raceUuid: uuid, name: "Kids", subCategory: null, laps: 2, lapsCounter: 0, riders: w2.length, startTime: "10:00", isConnected: false, color: "#33d", heat: 2, status: "upcoming" },
    ] as never);
    await riders.getState().getRiders(uuid);
    const mk = (bib: number, i: number, category: string, heat: number) => ({ id: Date.now() * 10 + bib, raceUuid: uuid, bibNumber: bib, category, subCategory: null, checked: true,
      distance: null, elapsedLastLap: null, elapsedTimeFromStart: null, timeStartRace: null, timeArrive: null, firstName: "Test", middleName: null, flag: null,
      lapsCounter: 0, lapsDetails: [], lastName: `Rider${bib}`, position_start: i + 1, position_category: 0, position_race: 0, raceStatus: "upcoming",
      status: "standing", team: null, viewOrder: i, totalLaps: 0, heat, color: null, image: null, comment: null });
    await riders.getState().insertRiders([...w1.map((b, i) => mk(b, i, "Elite", 1)), ...w2.map((b, i) => mk(b, i, "Kids", 2))] as never);
    return uuid;
  }, { w1: WAVE1, w2: WAVE2, raceName });
}

const lapsOn = async (page: Page, bib: number) => Number(((await racingCard(page, bib).getAttribute("data-laps")) ?? "0/0").split("/")[0]);

/** Shares the open local race from the Team tab and returns an admin invitation link (path only). */
async function shareWithAdminLink(page: Page, localUuid: string): Promise<string> {
  await page.goto(`/race/${localUuid}`);
  await page.getByRole("button", { name: "Team", exact: true }).click();
  await page.getByTestId("publish-race").click();
  await expect(page.getByTestId("sync-badge")).toContainText("Synced");
  const linkEditor = page.locator("text=Roles (any combination)").locator("..").nth(1);
  await linkEditor.getByRole("button", { name: "Viewer (read-only)" }).click(); // off
  await linkEditor.getByRole("button", { name: "Admin", exact: true }).click(); // on
  await linkEditor.getByRole("button", { name: "Create link + QR" }).click();
  const urlBox = page.locator('input[readonly][dir="ltr"]');
  await expect(urlBox).toHaveValue(/\/invite\//);
  return new URL(await urlBox.inputValue()).pathname;
}

async function acceptInvite(page: Page, path: string): Promise<string> {
  await page.goto(path);
  await page.getByRole("button", { name: "Accept" }).click();
  await page.waitForURL(/\/race\/[0-9a-f-]{36}$/);
  return page.url().split("/race/")[1];
}

/** One rider of a race, read from this page's stores. */
const riderOn = (page: Page, raceUuid: string, bib: number) =>
  page.evaluate(async ({ raceUuid, bib }) => {
    const riders = (await import("/src/app/stores/ridersStore.ts")).default;
    const r = (await riders.getState().getRiders(raceUuid)).find((x) => x.bibNumber === bib);
    return r ? { lastName: r.lastName, team: r.team } : null;
  }, { raceUuid, bib });

/** A rider edit through the store (the same path the Riders screen uses). */
const editRider = (page: Page, raceUuid: string, bib: number, patch: Record<string, unknown>) =>
  page.evaluate(async ({ raceUuid, bib, patch }) => {
    const riders = (await import("/src/app/stores/ridersStore.ts")).default;
    const r = (await riders.getState().getRiders(raceUuid)).find((x) => x.bibNumber === bib)!;
    await riders.getState().updateRider({ ...r, ...patch });
  }, { raceUuid, bib, patch });

const pendingOn = (page: Page, raceUuid: string) =>
  page.evaluate(async (u) => (await import("/src/app/services/live/liveClient.ts")).pendingCount(u), raceUuid);

test("two commissaires run one shared race live, both ways, within their waves", async ({ browser }) => {
  const A = await newUserPage(browser);
  const B = await newUserPage(browser);

  await test.step("both sign up in the app", async () => {
    await signUp(A.page, "Owner");
    await signUp(B.page, "Counter");
  });

  let localUuid = "";
  await test.step("owner shares a local race from the Team tab", async () => {
    localUuid = await seedLocalRace(A.page);
    await A.page.goto(`/race/${localUuid}`);
    await A.page.getByRole("button", { name: "Team", exact: true }).click();
    await A.page.getByTestId("publish-race").click();
    await expect(A.page.getByText("Invite commissaires")).toBeVisible();
    await expect(A.page.getByTestId("sync-badge")).toContainText("Synced");
  });

  let inviteUrl = "";
  await test.step("owner makes a counter invitation for wave 1 (link + QR)", async () => {
    const editors = A.page.locator("text=Roles (any combination)").locator("..");
    const linkEditor = editors.nth(1);
    await linkEditor.getByRole("button", { name: "Viewer (read-only)" }).click(); // off
    await linkEditor.getByRole("button", { name: "Laps (counter)" }).click(); // on
    await linkEditor.getByRole("button", { name: "Wave 1" }).click();
    await linkEditor.getByRole("button", { name: "Create link + QR" }).click();
    const urlBox = A.page.locator('input[readonly][dir="ltr"]');
    await expect(urlBox).toHaveValue(/\/invite\//);
    await expect(A.page.locator("svg").first()).toBeVisible();
    inviteUrl = new URL(await urlBox.inputValue()).pathname;
  });

  let sharedUuid = "";
  await test.step("counter accepts and gets only wave 1", async () => {
    await B.page.goto(inviteUrl);
    await expect(B.page.getByText("Shared E2E Race")).toBeVisible();
    await expect(B.page.getByText(/counter/)).toBeVisible();
    await B.page.getByRole("button", { name: "Accept" }).click();
    await B.page.waitForURL(/\/race\/[0-9a-f-]{36}$/);
    sharedUuid = B.page.url().split("/race/")[1];
    const bibs = await B.page.evaluate(async (u) => {
      const riders = (await import("/src/app/stores/ridersStore.ts")).default;
      return (await riders.getState().getRiders(u)).map((r) => r.bibNumber).sort();
    }, sharedUuid);
    expect(bibs).toEqual(WAVE1);
  });

  await test.step("owner starts wave 1 on the Grid; the counter's app sees it", async () => {
    await A.page.getByRole("tab", { name: "Race", exact: true }).click();
    await A.page.locator('button[class*="wavePill"]', { hasText: /^1\b/ }).first().click();
    await A.page.getByRole("button", { name: "Grid", exact: true }).click();
    await A.page.getByTestId("start-all").first().click();
    await expect(A.page.getByText(/RUNNING/).first()).toBeVisible();
    await expect.poll(() => B.page.evaluate(async (u) => {
      const cats = (await import("/src/app/stores/categoryStore.ts")).default;
      return cats.getState().categories.find((c) => c.raceUuid === u && c.heat === 1)?.status;
    }, sharedUuid), { timeout: 15_000 }).toBe("running");
  });

  await test.step("counter taps laps on Live; the owner sees them", async () => {
    await B.page.goto(`/race/${sharedUuid}/heat/1`);
    await expect(racingCard(B.page, 301)).toBeVisible();
    await expect(racingCard(B.page, 401)).toHaveCount(0); // wave 2 is not this member's
    await racingCard(B.page, 301).click();
    await B.page.waitForTimeout(500); // single-tap window
    await racingCard(B.page, 302).click();
    await B.page.waitForTimeout(500);
    await A.page.goto(`/race/${localUuid}/heat/1`);
    await expect.poll(() => lapsOn(A.page, 301), { timeout: 15_000 }).toBe(1);
    await expect.poll(() => lapsOn(A.page, 302), { timeout: 15_000 }).toBe(1);
  });

  await test.step("owner taps a lap; the counter sees it", async () => {
    await racingCard(A.page, 303).click();
    await A.page.waitForTimeout(500);
    await expect.poll(() => lapsOn(B.page, 303), { timeout: 15_000 }).toBe(1);
  });

  await test.step("a Joker resolved on the counter's phone lands on the owner's", async () => {
    await B.page.goto("/main");
    await B.page.getByRole("button", { name: "Open menu" }).click();
    await B.page.getByRole("checkbox", { name: /Show Joker button/i }).check();
    await B.page.getByRole("button", { name: "Close menu" }).click();
    await B.page.goto(`/race/${sharedUuid}/heat/1`);
    await B.page.getByRole("button", { name: "Add Joker" }).click();
    await B.page.locator('[data-testid="joker-card-1"]').click();
    await B.page.getByPlaceholder("Bib #").fill("304");
    await B.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => lapsOn(A.page, 304), { timeout: 15_000 }).toBe(1);
  });

  await test.step("undo on the counter's phone removes exactly that lap on the owner's", async () => {
    await racingCard(B.page, 301).dblclick();
    await B.page.getByRole("button", { name: /Revert Last Lap/ }).click();
    await expect.poll(() => lapsOn(A.page, 301), { timeout: 15_000 }).toBe(0);
    expect(await lapsOn(A.page, 302)).toBe(1);
  });

  await test.step("the counter may not start a wave (blocked on the device, nothing changes)", async () => {
    const allowed = await B.page.evaluate(async (u) => (await import("/src/app/services/live/liveBridge.ts")).liveAllows(u, "WaveStarted", { heat: 2 }), sharedUuid);
    expect(allowed).toBe(false);
  });

  await test.step("an offline tap on the counter's phone is queued, then arrives after reconnecting", async () => {
    // 301 has no counted lap (its lap was undone), so its next crossing counts.
    await B.ctx.setOffline(true);
    await B.page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await racingCard(B.page, 301).click();
    await B.page.waitForTimeout(500);
    expect(await B.page.evaluate(async (u) => (await import("/src/app/services/live/liveClient.ts")).pendingCount(u), sharedUuid)).toBe(1);
    expect(await lapsOn(A.page, 301)).toBe(0);
    await B.ctx.setOffline(false);
    await B.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => lapsOn(A.page, 301), { timeout: 30_000 }).toBe(1);
    await expect(B.page.getByTestId("sync-badge")).toContainText("Synced", { timeout: 15_000 });
  });

  await A.ctx.close();
  await B.ctx.close();
});

test("setup edits propagate both ways; each shared race keeps its own offline outbox", async ({ browser }) => {
  const A = await newUserPage(browser);
  const B = await newUserPage(browser);
  await signUp(A.page, "Organizer");
  await signUp(B.page, "Deputy");

  // Two shared races, B is admin in both. a* = A's local uuids, b* = B's.
  const a1 = await seedLocalRace(A.page, "Setup Race One");
  const b1 = await acceptInvite(B.page, await shareWithAdminLink(A.page, a1));
  const a2 = await seedLocalRace(A.page, "Setup Race Two");
  const b2 = await acceptInvite(B.page, await shareWithAdminLink(A.page, a2));

  await test.step("a rider edit on A reaches B", async () => {
    await A.page.goto(`/race/${a1}`);
    await editRider(A.page, a1, 302, { lastName: "Renamed", team: "Blue Club" });
    await B.page.goto(`/race/${b1}`);
    await expect.poll(() => riderOn(B.page, b1, 302), { timeout: 15_000 }).toEqual({ lastName: "Renamed", team: "Blue Club" });
  });

  await test.step("category laps and start time changed on B reach A", async () => {
    await B.page.evaluate(async (u) => {
      const cats = (await import("/src/app/stores/categoryStore.ts")).default;
      const elite = (await cats.getState().getCategories(u)).find((c) => c.name === "Elite")!;
      await cats.getState().upsertCategories([{ ...elite, laps: 6, startTime: "09:30" }]);
    }, b1);
    await A.page.goto(`/race/${a1}`);
    await expect.poll(() => A.page.evaluate(async (u) => {
      const cats = (await import("/src/app/stores/categoryStore.ts")).default;
      const c = cats.getState().categories.find((x) => x.raceUuid === u && x.name === "Elite");
      return c ? `${c.laps}@${c.startTime}` : null;
    }, a1), { timeout: 15_000 }).toBe("6@09:30");
  });

  await test.step("race info edited on A reaches B", async () => {
    await A.page.evaluate(async (u) => {
      const races = (await import("/src/app/stores/racesStore.ts")).default;
      const r = (await races.getState().getRaces()).find((x) => x.uuid === u)!;
      await races.getState().updateRace({ ...r, location: "North Park" });
    }, a1);
    await B.page.goto(`/race/${b1}`);
    await expect.poll(() => B.page.evaluate(async (u) => {
      const races = (await import("/src/app/stores/racesStore.ts")).default;
      return races.getState().races.find((x) => x.uuid === u)?.location;
    }, b1), { timeout: 15_000 }).toBe("North Park");
  });

  await test.step("offline edits in two races queue separately and each lands in its own race", async () => {
    await B.ctx.setOffline(true);
    await B.page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await editRider(B.page, b1, 303, { lastName: "OfflineOne" });
    await editRider(B.page, b2, 303, { lastName: "OfflineTwo" });
    expect(await pendingOn(B.page, b1)).toBe(1);
    expect(await pendingOn(B.page, b2)).toBe(1);
    await B.ctx.setOffline(false);
    await B.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await pendingOn(B.page, b1)) + (await pendingOn(B.page, b2)), { timeout: 30_000 }).toBe(0);

    await A.page.goto(`/race/${a1}`);
    await expect.poll(async () => (await riderOn(A.page, a1, 303))?.lastName, { timeout: 15_000 }).toBe("OfflineOne");
    await A.page.goto(`/race/${a2}`);
    await expect.poll(async () => (await riderOn(A.page, a2, 303))?.lastName, { timeout: 15_000 }).toBe("OfflineTwo");
    // Neither edit leaked into the other race.
    expect((await riderOn(A.page, a1, 302))?.lastName).toBe("Renamed");
    expect((await riderOn(A.page, a2, 302))?.lastName).toBe("Rider302");
  });

  await test.step("an offline edit survives the tab closing right after it", async () => {
    // The API is unreachable (the app itself still loads: no service worker in tests).
    const api = new URL(process.env.MULTIUSER_API ?? "http://localhost:4000").host;
    const toApi = (u: URL) => u.host === api;
    const block = (route: import("@playwright/test").Route) => route.abort("internetdisconnected");
    await B.ctx.route(toApi, block);
    await editRider(B.page, b1, 304, { lastName: "Crash" });
    await B.page.close({ runBeforeUnload: false });
    B.page = await B.ctx.newPage();
    await B.page.goto("/main");
    expect(await pendingOn(B.page, b1)).toBe(1);
    await B.ctx.unroute(toApi, block);
    await B.page.goto(`/race/${b1}`);
    await expect.poll(() => pendingOn(B.page, b1), { timeout: 30_000 }).toBe(0);
    await A.page.goto(`/race/${a1}`);
    await expect.poll(async () => (await riderOn(A.page, a1, 304))?.lastName, { timeout: 15_000 }).toBe("Crash");
  });

  await A.ctx.close();
  await B.ctx.close();
});
