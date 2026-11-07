import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { TERMS_VERSION } from "../src/app/legal/terms";
import { gotoRaceMode, openRaceView, racingCard, selectWave } from "./helpers";

/**
 * Event day: several judges on ONE race at the same time, end to end in real browsers
 * against a real API + PostgreSQL (the local e2e stack — never production):
 *
 *   Owner + Start judge + Counter (wave 1 only) + Results judge, 4 browser contexts.
 *   - invitations: an email invitation to a NEWLY registered user (documents the
 *     verified-email limitation), then links/QR — each judge registers from the link;
 *   - judging switched on; roles enforced (UI + server);
 *   - the Start judge starts wave 1; Owner and Counter record laps at the same time and
 *     see each other's laps; the Counter can't start/finish waves or see wave 2;
 *   - Counter offline taps arrive exactly once;
 *   - Results judge corrects a lap count + status and undoes it; every device converges;
 *   - Owner revokes the Counter mid-race: offline taps are refused and listed as not applied;
 *   - judging off → judges read-only at once; Results identical everywhere.
 *
 * Run: cd server && npm run e2e:stack   (DB + API :4100 + app :3100), then
 *   MULTIUSER_E2E=1 E2E_API_URL=http://localhost:4100 E2E_BASE_URL=http://localhost:3100 npx playwright test tests/event-judges.spec.ts
 */
test.skip(!process.env.MULTIUSER_E2E || !process.env.E2E_API_URL, "needs the e2e stack (MULTIUSER_E2E=1, E2E_API_URL)");
test.setTimeout(420_000);

const API = `${process.env.E2E_API_URL}/api/v1`;
const API_LOG = process.env.E2E_API_LOG ?? path.join(os.tmpdir(), "commissaire-e2e", "api.log");
const SHOTS = process.env.E2E_SHOTS ?? path.join("test-results", "event-shots");
const stamp = Date.now();
const RACE = `Event Judges ${stamp}`;
const WAVE1 = [301, 302, 303, 304, 305, 306];
const WAVE2 = [401, 402];
const email = (who: string) => `${who.toLowerCase()}.${stamp}@x.test`;
const pass = (who: string) => `password-${who}`;

type Dev = { ctx: BrowserContext; page: Page; who: string; race: string };

async function device(browser: Browser, who: string, mobile = false): Promise<Dev> {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript((v) => localStorage.setItem("termsAcceptance", JSON.stringify({ version: v, acceptedAt: new Date().toISOString() })), TERMS_VERSION);
  const page = await ctx.newPage();
  page.on("dialog", (d) => void d.accept()); // confirms (remove member, corrections)
  return { ctx, page, who, race: "" };
}

const shot = async (page: Page, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};

async function fillNewAccount(page: Page, who: string) {
  await page.getByRole("tab", { name: "New account" }).click();
  await page.getByPlaceholder("Your name").fill(who);
  await page.getByPlaceholder("Email").fill(email(who));
  await page.getByPlaceholder("Password (8+ characters)").fill(pass(who));
  await page.getByPlaceholder("Repeat password").fill(pass(who));
  await page.getByRole("button", { name: "Create account" }).click();
}

/** A judge opens an invitation link signed out, registers from it and lands back on the invitation. */
async function registerFromInvite(d: Dev, invitePath: string) {
  await d.page.goto(invitePath);
  await d.page.getByRole("button", { name: "Sign in" }).click();
  await fillNewAccount(d.page, d.who);
  await expect(d.page).toHaveURL(/\/invite\//, { timeout: 20_000 });
}

async function acceptHere(d: Dev) {
  await d.page.getByRole("button", { name: "Accept" }).click();
  await d.page.waitForURL(/\/race\/[^/]+$/, { timeout: 20_000 });
  d.race = decodeURIComponent(d.page.url().split("/race/")[1]);
}

/** Seeds a local race through the app's own stores (synthetic riders, checked in). */
async function seedLocalRace(page: Page): Promise<string> {
  await page.goto("/main");
  return page.evaluate(async ({ w1, w2, name }) => {
    const races = (await import("/src/app/stores/racesStore.ts")).default;
    const cats = (await import("/src/app/stores/categoryStore.ts")).default;
    const riders = (await import("/src/app/stores/ridersStore.ts")).default;
    const { newLocalId } = await import("/src/app/utils/localId.ts");
    const uuid = crypto.randomUUID();
    await races.getState().insertRace({ id: newLocalId(), uuid, owner: "Owner", name, location: "Park", time: "09:00", date: "2026-11-06",
      image: "", heat: "", type: "", level: "", orgenizer: "", manager: "", phone: "", takanon: "", site: "", map: "", distance: 0, isActive: true,
      createdAt: new Date(), lastUpdateAt: new Date() } as never);
    await cats.getState().upsertCategories([
      { id: newLocalId(), raceUuid: uuid, name: "Elite", subCategory: null, laps: 5, lapsCounter: 0, riders: 4, startTime: "09:00", isConnected: false, color: "#d33", heat: 1, status: "upcoming" },
      { id: newLocalId(), raceUuid: uuid, name: "Youth", subCategory: null, laps: 3, lapsCounter: 0, riders: 2, startTime: "09:00", isConnected: false, color: "#3a3", heat: 1, status: "upcoming" },
      { id: newLocalId(), raceUuid: uuid, name: "Kids", subCategory: null, laps: 2, lapsCounter: 0, riders: w2.length, startTime: "10:00", isConnected: false, color: "#33d", heat: 2, status: "upcoming" },
    ] as never);
    await riders.getState().getRiders(uuid);
    const mk = (bib: number, i: number, category: string, heat: number) => ({ id: newLocalId(), raceUuid: uuid, bibNumber: bib, category, subCategory: null, checked: true,
      distance: null, elapsedLastLap: null, elapsedTimeFromStart: null, timeStartRace: null, timeArrive: null, firstName: "Test", middleName: null, flag: null,
      lapsCounter: 0, lapsDetails: [], lastName: `Rider${bib}`, position_start: i + 1, position_category: 0, position_race: 0, raceStatus: "upcoming",
      status: "standing", team: null, viewOrder: i, totalLaps: 0, heat, color: null, image: null, comment: null });
    await riders.getState().insertRiders([
      ...w1.map((b, i) => mk(b, i, b <= 304 ? "Elite" : "Youth", 1)),
      ...w2.map((b, i) => mk(b, i, "Kids", 2)),
    ] as never);
    return uuid;
  }, { w1: WAVE1, w2: WAVE2, name: RACE });
}

/** This device's view of every rider: bib → "laps|status". */
const ridersOn = (d: Dev) =>
  d.page.evaluate(async (u) => {
    const riders = (await import("/src/app/stores/ridersStore.ts")).default;
    const out: Record<number, string> = {};
    for (const r of riders.getState().riders.filter((x) => x.raceUuid === u)) out[r.bibNumber as number] = `${r.lapsCounter}|${r.status}`;
    return out;
  }, d.race);
const lapsOf = async (d: Dev, bib: number) => Number(((await ridersOn(d))[bib] ?? "-1|").split("|")[0]);
const statusOf = async (d: Dev, bib: number) => ((await ridersOn(d))[bib] ?? "|").split("|")[1];
const pending = (d: Dev) => d.page.evaluate(async (u) => (await import("/src/app/services/live/liveClient.ts")).pendingCount(u), d.race);
const notApplied = (d: Dev) =>
  d.page.evaluate(async (u) => (await import("/src/app/services/live/liveClient.ts")).useLiveStore.getState().sync[u]?.notApplied.length ?? 0, d.race);
const allows = (d: Dev, type: string, payload: Record<string, unknown>) =>
  d.page.evaluate(async ({ u, type, payload }) => (await import("/src/app/services/live/liveBridge.ts")).liveAllows(u, type, payload), { u: d.race, type, payload });
const riderUuid = (d: Dev, bib: number) =>
  d.page.evaluate(async ({ u, bib }) => {
    const riders = (await import("/src/app/stores/ridersStore.ts")).default;
    return (await riders.getState().getRiders(u)).find((r) => r.bibNumber === bib)?.uuid ?? "";
  }, { u: d.race, bib });

/** The server's truth (owner token), bib → "laps|status". */
async function serverRiders(): Promise<Record<number, string>> {
  const login = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email("Owner"), password: pass("Owner") }) })).json();
  const h = { authorization: `Bearer ${login.accessToken}` };
  const { races } = await (await fetch(`${API}/races`, { headers: h })).json();
  const uuid = races.find((r: { race: { name: string } }) => r.race.name === RACE).race.uuid;
  const snap = await (await fetch(`${API}/races/${uuid}/snapshot`, { headers: h })).json();
  const out: Record<number, string> = {};
  for (const r of snap.riders) out[r.bibNumber] = `${r.lapsCounter}|${r.status}`;
  return out;
}

/** The last email the API "sent" to this address (MAIL_TRANSPORT=log), as text. */
function lastMailTo(to: string): string {
  const lines = fs.readFileSync(API_LOG, "utf8").split(/\r?\n/).filter((l) => l.includes(to) && l.includes("mail (log transport"));
  expect(lines.length, `an email to ${to} in ${API_LOG}`).toBeGreaterThan(0);
  return JSON.parse(lines.at(-1)!).text as string;
}

async function tap(page: Page, bib: number) {
  await racingCard(page, bib).click();
  await page.waitForTimeout(450); // single-tap window (a double tap opens the rider modal)
}

const ROLE_CHIPS = ["Admin", "Start", "Laps (counter)", "Check-in", "Results (corrections)", "Viewer (read-only)"];

/**
 * Owner's Team panel: the second AccessEditor makes a link + QR with exactly these roles.
 * The editor keeps its chips after "Create link" (finding: easy to over-grant on the next
 * link), so every chip is set explicitly from its on/off class.
 */
async function makeLink(owner: Page, roleChips: string[], wave?: number): Promise<string> {
  const editor = owner.locator("text=Roles (any combination)").locator("..").nth(1);
  const setChip = async (name: string, on: boolean) => {
    const chip = editor.getByRole("button", { name, exact: true });
    if (!(await chip.count())) return;
    const isOn = /chipOn/.test((await chip.getAttribute("class")) ?? "");
    if (isOn !== on) await chip.click();
  };
  for (const r of ROLE_CHIPS) await setChip(r, roleChips.includes(r));
  for (const w of [1, 2]) await setChip(`Wave ${w}`, w === wave);
  const urlBox = owner.locator('input[readonly][dir="ltr"]');
  const before = (await urlBox.count()) ? await urlBox.inputValue() : "";
  await editor.getByRole("button", { name: "Create link + QR" }).click();
  await expect(urlBox).toHaveValue(/\/invite\//);
  await expect.poll(() => urlBox.inputValue()).not.toBe(before);
  return new URL(await urlBox.inputValue()).pathname;
}

test("event day: owner + three judges run one race at the same time", async ({ browser }) => {
  const A = await device(browser, "Owner");
  const S = await device(browser, "Starter", true);
  const C = await device(browser, "Counter", true);
  const R = await device(browser, "Results");

  await test.step("owner signs up, shares the race and switches judging on", async () => {
    await A.page.goto("/account");
    await fillNewAccount(A.page, "Owner");
    await expect(A.page).toHaveURL(/\/main/, { timeout: 20_000 });
    A.race = await seedLocalRace(A.page);
    await A.page.goto(`/race/${A.race}/team`);
    await A.page.getByTestId("publish-race").click();
    await expect(A.page.getByText("Invite commissaires")).toBeVisible({ timeout: 20_000 });
    const toggle = A.page.getByTestId("member-writes-toggle");
    await expect(toggle).not.toBeChecked();
    await toggle.click(); // async switch: the box flips once the server agreed
    await expect(toggle).toBeChecked();
  });

  await test.step("email invitation to a NEW user: password sign-up can't accept it (verified email needed)", async () => {
    const editor = A.page.locator("text=Roles (any combination)").locator("..").nth(0);
    await A.page.getByPlaceholder("Email addresses (comma or new line)").fill(email("Results"));
    await editor.getByRole("button", { name: "Laps (counter)" }).click(); // default counter off
    await editor.getByRole("button", { name: "Results (corrections)" }).click();
    await editor.getByRole("button", { name: "Send invitations" }).click();
    await expect(A.page.getByText("1 invitation(s) sent")).toBeVisible();
    const url = /https?:\/\/\S+\/invite\/\S+/.exec(lastMailTo(email("Results")))![0];
    await registerFromInvite(R, new URL(url).pathname);
    await expect(R.page.getByText(/Sign in with that email \(verified\) to accept/)).toBeVisible();
    await expect(R.page.getByRole("button", { name: "Accept" })).toHaveCount(0);
    await expect(A.page.getByTestId("invite-email-hint")).toContainText("Create link + QR"); // the owner is told to use a link
  });

  await test.step("judges join by link / QR: Results judge (existing account), Start judge and Counter (new accounts)", async () => {
    const resultsLink = await makeLink(A.page, ["Results (corrections)"]);
    await R.page.goto(resultsLink);
    await acceptHere(R);
    const startLink = await makeLink(A.page, ["Start"]);
    await registerFromInvite(S, startLink);
    await acceptHere(S);
    const counterLink = await makeLink(A.page, ["Laps (counter)"], 1);
    await registerFromInvite(C, counterLink);
    await expect(C.page.getByText(/waves 1/)).toBeVisible();
    await acceptHere(C);
    await A.page.reload();
    for (const who of ["Starter", "Counter", "Results"]) await expect(A.page.locator("li").filter({ hasText: email(who) })).toBeVisible();
    await shot(A.page, "01-owner-team-panel-judges");
  });

  await test.step("roles: the Counter gets wave 1 only and can't start or finish waves", async () => {
    await expect.poll(async () => Object.keys(await ridersOn(C)).map(Number).sort(), { timeout: 15_000 }).toEqual(WAVE1);
    // Each device learns its access from the server right after accepting.
    await expect.poll(() => allows(C, "WaveStarted", { heat: 1 }), { timeout: 15_000 }).toBe(false);
    expect(await allows(C, "WaveFinished", { heat: 1 })).toBe(false);
    await expect.poll(async () => allows(R, "AddLap", { riderUuid: await riderUuid(R, 301) }), { timeout: 15_000 }).toBe(false);
    expect(await allows(S, "WaveStarted", { heat: 1 })).toBe(true);
  });

  await test.step("the Start judge starts wave 1; every device sees it", async () => {
    await A.page.goto(`/race/${A.race}`); // the owner follows the race (Team joins no live room)
    await S.page.goto(`/race/${S.race}`);
    await gotoRaceMode(S.page, "Race");
    await selectWave(S.page, 1);
    await openRaceView(S.page, "Grid");
    await S.page.getByTestId("start-all").first().click();
    for (const d of [A, C, R]) {
      await expect.poll(async () => (await ridersOn(d))[301]?.split("|")[0] !== undefined && d.page.evaluate(async (u) => {
        const cats = (await import("/src/app/stores/categoryStore.ts")).default;
        return cats.getState().categories.find((c) => c.raceUuid === u && c.name === "Elite")?.status;
      }, d.race), { timeout: 20_000 }).toBe("running");
    }
  });

  await test.step("Owner and Counter record laps at the same time and see each other's", async () => {
    await A.page.goto(`/race/${A.race}/heat/1`);
    await C.page.goto(`/race/${C.race}/heat/1`);
    await expect(racingCard(C.page, 301)).toBeVisible();
    await expect(racingCard(C.page, 401)).toHaveCount(0);
    await Promise.all([
      (async () => { await tap(C.page, 301); await tap(C.page, 302); })(),
      (async () => { await tap(A.page, 305); await tap(A.page, 306); })(),
    ]);
    for (const d of [A, C, S, R]) {
      for (const bib of [301, 302, 305, 306]) await expect.poll(() => lapsOf(d, bib), { timeout: 20_000, message: `${d.who} sees a lap on ${bib}` }).toBe(1);
    }
    await shot(C.page, "02-counter-live-screen");
  });

  await test.step("a Counter that forces a wave finish is refused by the server and told so", async () => {
    await C.page.evaluate(async (u) => (await import("/src/app/services/live/liveClient.ts")).dispatchAction(u, "WaveFinished", { heat: 1 }), C.race);
    await expect.poll(() => notApplied(C), { timeout: 20_000 }).toBe(1);
    await expect(C.page.getByTestId("not-applied-open")).toContainText("1 not applied");
    expect(await A.page.evaluate(async (u) => {
      const cats = (await import("/src/app/stores/categoryStore.ts")).default;
      return cats.getState().categories.find((c) => c.raceUuid === u && c.name === "Elite")?.status;
    }, A.race)).toBe("running");
  });

  await test.step("Counter offline: taps are queued and arrive exactly once", async () => {
    await C.ctx.setOffline(true);
    await C.page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await tap(C.page, 303);
    await tap(C.page, 304);
    expect(await pending(C)).toBe(2);
    expect(await lapsOf(A, 303)).toBe(0);
    await C.ctx.setOffline(false);
    await C.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => pending(C), { timeout: 30_000 }).toBe(0);
    for (const bib of [303, 304]) await expect.poll(() => lapsOf(A, bib), { timeout: 20_000 }).toBe(1);
    await C.page.reload(); // a reload must not resend anything
    await expect(racingCard(C.page, 303)).toBeVisible();
    await C.page.waitForTimeout(3_000);
    const server = await serverRiders();
    for (const bib of [301, 302, 303, 304, 305, 306]) expect(server[bib], `bib ${bib} on the server`).toBe("1|standing");
  });

  await test.step("Results judge corrects a lap count and a status, then undoes both; all converge", async () => {
    await R.page.goto(`/race/${R.race}/results`);
    await R.page.getByText("Rider302 Test").first().click();
    const panel = R.page.getByTestId("result-correction");
    await expect(panel).toBeVisible();
    await panel.getByTestId("correct-laps").fill("3");
    await panel.getByTestId("correct-laps-save").click();
    for (const d of [A, C, S, R]) await expect.poll(() => lapsOf(d, 302), { timeout: 20_000 }).toBe(3);
    await R.page.getByTestId("correct-status-DNF").click();
    for (const d of [A, C, S, R]) await expect.poll(() => statusOf(d, 302), { timeout: 20_000 }).toBe("DNF");
    await R.page.getByTestId("correct-status-clear").click();
    for (const d of [A, C, S, R]) await expect.poll(() => statusOf(d, 302), { timeout: 20_000 }).not.toBe("DNF");
    await R.page.getByTestId("correct-laps-undo").click();
    for (const d of [A, C, S, R]) await expect.poll(() => lapsOf(d, 302), { timeout: 20_000 }).toBe(1);
    await R.page.keyboard.press("Escape");
  });

  await test.step("Owner revokes the Counter mid-race: its offline taps are refused and listed", async () => {
    await C.page.goto(`/race/${C.race}/heat/1`);
    await expect(racingCard(C.page, 305)).toBeVisible();
    await C.ctx.setOffline(true);
    await C.page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await tap(C.page, 305);
    await tap(C.page, 306);
    expect(await pending(C)).toBe(2);

    await A.page.goto(`/race/${A.race}/team`);
    const row = A.page.locator("li").filter({ hasText: email("Counter") });
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(A.page.locator("li").filter({ hasText: email("Counter") })).toHaveCount(0);

    await C.ctx.setOffline(false);
    await C.page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(C.page.getByTestId("sync-badge")).toContainText("No access", { timeout: 30_000 });
    await expect.poll(() => notApplied(C), { timeout: 30_000 }).toBe(3);
    await C.page.getByTestId("not-applied-open").click();
    await expect(C.page.getByTestId("rejected-item")).toHaveCount(3);
    await shot(C.page, "03-counter-revoked-not-applied");
    const server = await serverRiders();
    expect(server[305]).toBe("1|standing");
    expect(server[306]).toBe("1|standing");
    // A tap after the revocation is not recorded at all.
    expect(await allows(C, "AddLap", { riderUuid: await riderUuid(C, 301) })).toBe(false);
  });

  await test.step("Owner switches judging off: judges are read-only at once", async () => {
    await A.page.getByTestId("member-writes-toggle").click();
    await expect(A.page.getByTestId("member-writes-toggle")).not.toBeChecked();
    await expect.poll(() => allows(S, "WaveFinished", { heat: 1 }), { timeout: 20_000 }).toBe(false);
    await expect.poll(async () => allows(R, "LapCountCorrection", { riderUuid: await riderUuid(R, 301), laps: 2 }), { timeout: 20_000 }).toBe(false);
    await R.page.goto(`/race/${R.race}/results`);
    await R.page.getByText("Rider301 Test").first().click();
    await expect(R.page.getByTestId("result-correction")).toHaveCount(0);
    await R.page.keyboard.press("Escape");
  });

  await test.step("Results are the same on every device and on the server", async () => {
    const server = await serverRiders();
    for (const d of [A, S, R]) {
      const mine = await ridersOn(d);
      for (const bib of WAVE1) expect(mine[bib], `${d.who} bib ${bib}`).toBe(server[bib]);
    }
    // The Results screen ranks them identically.
    const order = async (d: Dev) => {
      await d.page.goto(`/race/${d.race}/results`);
      const block = d.page.getByTestId("results-category").filter({ hasText: "Elite" }).first();
      await expect(block).toContainText("Rider301");
      return (await block.innerText()).replace(/\s+/g, " ");
    };
    const ownerView = await order(A);
    expect(await order(S)).toBe(ownerView);
    expect(await order(R)).toBe(ownerView);
  });

  for (const d of [A, S, C, R]) await d.ctx.close();
});
