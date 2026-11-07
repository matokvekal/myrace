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
 *   - a Viewer (link) is read-only everywhere; the Counter can't start/finish waves, can't
 *     see wave 2 and a forced lap on a wave-2 rider is refused (out of scope);
 *   - the Start judge starts wave 1; Owner and Counter record laps on DIFFERENT riders at
 *     the same time → every device converges to the same Board / Results;
 *   - Owner and Counter tap the SAME rider at the same time → exactly one lap (first
 *     write wins), no "not applied" entry, both devices show the server's time;
 *   - Counter offline taps arrive exactly once; a DELAYED duplicate (offline Counter taps
 *     a rider the Owner already recorded) is resolved as a duplicate, time unchanged;
 *   - the Live "Sync" button repairs a device whose screen went wrong;
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
const WAVE1 = [301, 302, 303, 304, 305, 306, 307, 308, 309, 310];
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
      { id: newLocalId(), raceUuid: uuid, name: "Elite", subCategory: null, laps: 5, lapsCounter: 0, riders: 5, startTime: "09:00", isConnected: false, color: "#d33", heat: 1, status: "upcoming" },
      { id: newLocalId(), raceUuid: uuid, name: "Youth", subCategory: null, laps: 3, lapsCounter: 0, riders: 5, startTime: "09:00", isConnected: false, color: "#3a3", heat: 1, status: "upcoming" },
      { id: newLocalId(), raceUuid: uuid, name: "Kids", subCategory: null, laps: 2, lapsCounter: 0, riders: w2.length, startTime: "10:00", isConnected: false, color: "#33d", heat: 2, status: "upcoming" },
    ] as never);
    await riders.getState().getRiders(uuid);
    const mk = (bib: number, i: number, category: string, heat: number) => ({ id: newLocalId(), raceUuid: uuid, bibNumber: bib, category, subCategory: null, checked: true,
      distance: null, elapsedLastLap: null, elapsedTimeFromStart: null, timeStartRace: null, timeArrive: null, firstName: "Test", middleName: null, flag: null,
      lapsCounter: 0, lapsDetails: [], lastName: `Rider${bib}`, position_start: i + 1, position_category: 0, position_race: 0, raceStatus: "upcoming",
      status: "standing", team: null, viewOrder: i, totalLaps: 0, heat, color: null, image: null, comment: null });
    await riders.getState().insertRiders([
      ...w1.map((b, i) => mk(b, i, b <= 305 ? "Elite" : "Youth", 1)),
      ...w2.map((b, i) => mk(b, i, "Kids", 2)),
    ] as never);
    return uuid;
  }, { w1: WAVE1, w2: WAVE2, name: RACE });
}

/** This device's view of every rider: bib → "laps|status" (+ "|timeArrive" with `withTime`). */
const ridersOn = (d: Dev, withTime = false) =>
  d.page.evaluate(async ({ u, withTime }) => {
    const riders = (await import("/src/app/stores/ridersStore.ts")).default;
    const out: Record<number, string> = {};
    for (const r of riders.getState().riders.filter((x) => x.raceUuid === u)) out[r.bibNumber as number] = `${r.lapsCounter}|${r.status}${withTime ? `|${r.timeArrive ?? ""}` : ""}`;
    return out;
  }, { u: d.race, withTime });
const timeOf = async (d: Dev, bib: number) => ((await ridersOn(d, true))[bib] ?? "||").split("|")[2];
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

/** The server's truth (owner token), bib → "laps|status" (+ "|timeArrive" with `withTime`). */
async function serverRiders(withTime = false): Promise<Record<number, string>> {
  const login = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email("Owner"), password: pass("Owner") }) })).json();
  const h = { authorization: `Bearer ${login.accessToken}` };
  const { races } = await (await fetch(`${API}/races`, { headers: h })).json();
  const uuid = races.find((r: { race: { name: string } }) => r.race.name === RACE).race.uuid;
  const snap = await (await fetch(`${API}/races/${uuid}/snapshot`, { headers: h })).json();
  const out: Record<number, string> = {};
  for (const r of snap.riders) out[r.bibNumber] = `${r.lapsCounter}|${r.status}${withTime ? `|${r.timeArrive ?? ""}` : ""}`;
  return out;
}
/** Same lap: identical "laps|status" and the same arrival time (to the millisecond). */
const TIME_TOLERANCE_MS = 0;
const sameTime = (a?: string, b?: string) => (!a && !b) || (!!a && !!b && Math.abs(Date.parse(a) - Date.parse(b)) <= TIME_TOLERANCE_MS);
const sameRider = (a?: string, b?: string) => {
  const [la, sa, ta] = (a ?? "").split("|");
  const [lb, sb, tb] = (b ?? "").split("|");
  return la === lb && sa === sb && sameTime(ta, tb);
};
const serverTimeOf = async (bib: number) => ((await serverRiders(true))[bib] ?? "||").split("|")[2];
const goOffline = async (d: Dev) => { await d.ctx.setOffline(true); await d.page.evaluate(() => window.dispatchEvent(new Event("offline"))); };
const goOnline = async (d: Dev) => { await d.ctx.setOffline(false); await d.page.evaluate(() => window.dispatchEvent(new Event("online"))); };
/**
 * Board of one device, as "P<pos> <bib> <laps>/<total>" per rider in screen order (every
 * wave). The live time column is left out: a rider without a lap shows a ticking clock.
 */
async function boardText(d: Dev): Promise<string> {
  await d.page.goto(`/race/${d.race}`);
  await gotoRaceMode(d.page, "Board");
  await expect(d.page.getByText("Wave 1 · 09:00")).toBeVisible({ timeout: 20_000 });
  await expect(d.page.locator("body")).toContainText(/P\d+\s*301\s*Rider301/);
  const text = (await d.page.locator("body").innerText()).replace(/\s+/g, " ");
  // Cells are inline spans ("P1301Rider301 Test1/500:02"): the bib must repeat in the name.
  return [...text.matchAll(/P(\d+?) ?(\d{3}) ?Rider\2 Test ?(\d+)\/(\d)/g)].map((m) => `P${m[1]} ${m[2]} ${m[3]}/${m[4]}`).join(" | ");
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
 * Every chip is set explicitly from its on/off class; after each link the editor must be
 * back to its default (Viewer only, no wave) so the next link can't over-grant by mistake.
 */
async function makeLink(owner: Page, roleChips: string[], wave?: number): Promise<string> {
  const editor = () => owner.locator("text=Roles (any combination)").locator("..").nth(1);
  const isOn = async (name: string) => /chipOn/.test((await editor().getByRole("button", { name, exact: true }).getAttribute("class")) ?? "");
  const setChip = async (name: string, on: boolean) => {
    const chip = editor().getByRole("button", { name, exact: true });
    if (!(await chip.count())) return;
    if ((await isOn(name)) !== on) await chip.click();
  };
  for (const r of ROLE_CHIPS) await setChip(r, roleChips.includes(r));
  for (const w of [1, 2]) await setChip(`Wave ${w}`, w === wave);
  const links = owner.getByTestId("invite-link");
  const before = await links.count();
  await editor().getByRole("button", { name: "Create link + QR" }).click();
  await expect(links).toHaveCount(before + 1); // newest first
  const url = await links.first().locator('input[readonly][dir="ltr"]').inputValue();
  expect(url).toMatch(/\/invite\//);
  // The role picker resets after each link.
  await expect.poll(() => isOn("Viewer (read-only)")).toBe(true);
  for (const r of ROLE_CHIPS.filter((r) => r !== "Viewer (read-only)" && r !== "Admin")) expect(await isOn(r), `${r} reset`).toBe(false);
  for (const w of [1, 2]) expect(await isOn(`Wave ${w}`), `Wave ${w} reset`).toBe(false);
  return new URL(url).pathname;
}

test("event day: owner + three judges run one race at the same time", async ({ browser }) => {
  const A = await device(browser, "Owner");
  const S = await device(browser, "Starter", true);
  const C = await device(browser, "Counter", true);
  const R = await device(browser, "Results");
  const all = [A, S, C, R];
  const eliteStatus = (d: Dev) => d.page.evaluate(async (u) => {
    const cats = (await import("/src/app/stores/categoryStore.ts")).default;
    return cats.getState().categories.find((c) => c.raceUuid === u && c.name === "Elite")?.status;
  }, d.race);
  let counterNotApplied = 0; // refused Actions the Counter must have listed so far

  try {
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
      await expect(R.page.getByText(/your account hasn't verified it yet\. Ask the organizer for an invitation link or QR code/)).toBeVisible();
      await expect(R.page.getByRole("button", { name: "Accept" })).toHaveCount(0);
      await shot(R.page, "01-email-invite-new-account-guidance");
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
      await shot(A.page, "02-owner-team-panel-judges");
    });

    await test.step("roles: Counter = wave 1 laps only; Results = corrections only; Start = waves", async () => {
      await expect.poll(async () => Object.keys(await ridersOn(C)).map(Number).sort(), { timeout: 15_000 }).toEqual(WAVE1);
      // Each device learns its access from the server right after accepting.
      await expect.poll(() => allows(C, "WaveStarted", { heat: 1 }), { timeout: 15_000 }).toBe(false);
      expect(await allows(C, "WaveFinished", { heat: 1 })).toBe(false);
      expect(await allows(C, "AddLap", { riderUuid: await riderUuid(C, 301) })).toBe(true);
      await expect.poll(async () => allows(R, "AddLap", { riderUuid: await riderUuid(R, 301) }), { timeout: 15_000 }).toBe(false);
      expect(await allows(R, "LapCountCorrection", { riderUuid: await riderUuid(R, 301), laps: 1 })).toBe(true);
      expect(await allows(S, "WaveStarted", { heat: 1 })).toBe(true);
      expect(await allows(S, "AddLap", { riderUuid: await riderUuid(S, 301) })).toBe(false);
      // The Counter's Start screen still shows "Start Now" (finding: not hidden by role), but
      // the tap is refused on the device and nothing starts.
      await C.page.goto(`/race/${C.race}`);
      await gotoRaceMode(C.page, "Race");
      await selectWave(C.page, 1);
      await openRaceView(C.page, "Grid");
      await C.page.getByTestId("start-all").first().click();
      await expect(C.page.getByText(/Your role in this race does not allow this|outside your access/).first()).toBeVisible();
      await shot(C.page, "03-counter-start-refused");
      expect(await pending(C)).toBe(0);
      await C.page.waitForTimeout(1_000);
      expect(await eliteStatus(A)).toBe("upcoming");
      expect(await eliteStatus(C)).toBe("upcoming");
      // A forced lap on a wave-2 rider (outside the Counter's waves) is refused by the server.
      const kid = await riderUuid(A, 401);
      expect(kid).not.toBe("");
      await C.page.evaluate(async ({ u, kid }) => (await import("/src/app/services/live/liveClient.ts")).dispatchAction(u, "AddLap", { riderUuid: kid }), { u: C.race, kid });
      counterNotApplied++;
      await expect.poll(() => notApplied(C), { timeout: 20_000 }).toBe(counterNotApplied);
      expect(await C.page.evaluate(async (u) => (await import("/src/app/services/live/liveClient.ts")).useLiveStore.getState().sync[u]?.notApplied.at(-1)?.reason, C.race)).toBe("out_of_scope");
      expect((await serverRiders())[401]).toBe("0|standing");
    });

    await test.step("a Viewer (link) is read-only: no laps, no corrections, no start", async () => {
      const V = await device(browser, "Viewer");
      try {
        const viewerLink = await makeLink(A.page, ["Viewer (read-only)"]);
        await registerFromInvite(V, viewerLink);
        await acceptHere(V);
        await expect.poll(async () => Object.keys(await ridersOn(V)).length, { timeout: 15_000 }).toBeGreaterThan(0);
        await expect.poll(async () => allows(V, "AddLap", { riderUuid: await riderUuid(V, 301) }), { timeout: 15_000 }).toBe(false);
        expect(await allows(V, "LapCountCorrection", { riderUuid: await riderUuid(V, 301), laps: 1 })).toBe(false);
        expect(await allows(V, "WaveStarted", { heat: 1 })).toBe(false);
        await V.page.goto(`/race/${V.race}/results`);
        await V.page.getByText("Rider301 Test").first().click();
        await expect(V.page.getByTestId("result-correction")).toHaveCount(0);
        await shot(V.page, "04-viewer-results-read-only");
      } finally {
        await V.ctx.close(); // keep the run light: four contexts from here on
      }
    });

    await test.step("the Start judge starts wave 1; every device sees it", async () => {
      await A.page.goto(`/race/${A.race}`); // the owner follows the race (Team joins no live room)
      await S.page.goto(`/race/${S.race}`);
      await gotoRaceMode(S.page, "Race");
      await selectWave(S.page, 1);
      await openRaceView(S.page, "Grid");
      await S.page.getByTestId("start-all").first().click();
      for (const d of [A, C, R]) await expect.poll(() => eliteStatus(d), { timeout: 20_000 }).toBe("running");
    });

    await test.step("simultaneous laps on DIFFERENT riders: every device converges", async () => {
      await A.page.goto(`/race/${A.race}/heat/1`);
      await C.page.goto(`/race/${C.race}/heat/1`);
      await expect(racingCard(C.page, 301)).toBeVisible();
      await expect(racingCard(C.page, 401)).toHaveCount(0);
      await Promise.all([
        (async () => { await tap(C.page, 301); await tap(C.page, 302); })(),
        (async () => { await tap(A.page, 305); await tap(A.page, 306); })(),
      ]);
      for (const d of all) {
        for (const bib of [301, 302, 305, 306]) await expect.poll(() => lapsOf(d, bib), { timeout: 20_000, message: `${d.who} sees a lap on ${bib}` }).toBe(1);
      }
      const server = await serverRiders(true);
      for (const d of all) {
        const mine = await ridersOn(d, true);
        for (const bib of [301, 302, 305, 306]) expect(sameRider(mine[bib], server[bib]), `${d.who} bib ${bib}: ${mine[bib]} vs server ${server[bib]}`).toBe(true);
      }
      await shot(C.page, "05-counter-live-after-simultaneous");
    });

    await test.step("the SAME rider tapped on two devices at once: exactly one lap, first write kept", async () => {
      await Promise.all([tap(A.page, 307), tap(C.page, 307)]);
      await expect.poll(async () => (await serverRiders())[307], { timeout: 20_000 }).toBe("1|standing");
      for (const d of [A, C]) await expect.poll(() => pending(d), { timeout: 20_000 }).toBe(0);
      const kept = await serverTimeOf(307);
      expect(kept).toBeTruthy();
      for (const d of all) {
        await expect.poll(() => lapsOf(d, 307), { timeout: 20_000, message: `${d.who} one lap on 307` }).toBe(1);
        await expect.poll(async () => sameTime(await timeOf(d, 307), kept), { timeout: 20_000, message: `${d.who} keeps the server's time ${kept}` }).toBe(true);
      }
      expect(await notApplied(A)).toBe(0);
      expect(await notApplied(C)).toBe(counterNotApplied);
      await A.page.waitForTimeout(2_000);
      expect((await serverRiders())[307]).toBe("1|standing");
    });

    await test.step("a Counter that forces a wave finish is refused by the server and told so", async () => {
      await C.page.evaluate(async (u) => (await import("/src/app/services/live/liveClient.ts")).dispatchAction(u, "WaveFinished", { heat: 1 }), C.race);
      counterNotApplied++;
      await expect.poll(() => notApplied(C), { timeout: 20_000 }).toBe(counterNotApplied);
      await expect(C.page.getByTestId("not-applied-open")).toContainText(`${counterNotApplied} not applied`);
      expect(await eliteStatus(A)).toBe("running");
    });

    await test.step("Counter offline: taps are queued and arrive exactly once", async () => {
      await goOffline(C);
      await tap(C.page, 303);
      await tap(C.page, 304);
      expect(await pending(C)).toBe(2);
      expect(await lapsOf(A, 303)).toBe(0);
      await goOnline(C);
      await expect.poll(() => pending(C), { timeout: 30_000 }).toBe(0);
      for (const bib of [303, 304]) await expect.poll(() => lapsOf(A, bib), { timeout: 20_000 }).toBe(1);
      await C.page.reload(); // a reload must not resend anything
      await expect(racingCard(C.page, 303)).toBeVisible();
      await C.page.waitForTimeout(3_000);
      const server = await serverRiders();
      for (const bib of [301, 302, 303, 304, 305, 306, 307]) expect(server[bib], `bib ${bib} on the server`).toBe("1|standing");
    });

    await test.step("a DELAYED duplicate: offline Counter taps a rider the Owner recorded → resolved, time unchanged", async () => {
      await goOffline(C);
      await tap(C.page, 308); // the Counter saw the crossing first, but is offline
      expect(await pending(C)).toBe(1);
      await C.page.waitForTimeout(1_500);
      await tap(A.page, 308); // the Owner's report reaches the server first
      await expect.poll(async () => (await serverRiders())[308], { timeout: 20_000 }).toBe("1|standing");
      const kept = await serverTimeOf(308);
      await goOnline(C);
      await expect(C.page.getByText("Already recorded by another judge")).toBeVisible({ timeout: 30_000 });
      await shot(C.page, "06-counter-delayed-duplicate-resolved");
      await expect.poll(() => pending(C), { timeout: 30_000 }).toBe(0);
      expect(await notApplied(C)).toBe(counterNotApplied); // no "not applied" entry for a duplicate
      expect((await serverRiders(true))[308]).toBe(`1|standing|${kept}`); // the server's time did not move
      for (const d of all) {
        await expect.poll(() => lapsOf(d, 308), { timeout: 20_000, message: `${d.who} one lap on 308` }).toBe(1);
        await expect.poll(async () => sameTime(await timeOf(d, 308), kept), { timeout: 20_000, message: `${d.who} keeps the Owner's time ${kept}` }).toBe(true);
      }
    });

    await test.step("the Live Sync button repairs a device whose screen went wrong", async () => {
      // Simulate a missed update: this device's cache drifts from the server without an Action.
      await C.page.evaluate(async (u) => {
        const riders = (await import("/src/app/stores/ridersStore.ts")).default;
        riders.setState((st) => ({ riders: st.riders.map((r) => (r.raceUuid === u && r.bibNumber === 301 ? { ...r, lapsCounter: 4 } : r)) }));
      }, C.race);
      expect(await lapsOf(C, 301)).toBe(4);
      await C.page.getByTestId("live-sync-now").click();
      await expect(C.page.getByTestId("live-sync-now-status")).toContainText("Synced", { timeout: 20_000 });
      await expect.poll(() => lapsOf(C, 301), { timeout: 20_000 }).toBe(1);
      await shot(C.page, "07-counter-sync-button");
      expect((await serverRiders())[301]).toBe("1|standing");
    });

    await test.step("Results judge corrects a lap count and a status, then undoes both; all converge", async () => {
      await R.page.goto(`/race/${R.race}/results`);
      await R.page.getByText("Rider302 Test").first().click();
      const panel = R.page.getByTestId("result-correction");
      await expect(panel).toBeVisible();
      await panel.getByTestId("correct-laps").fill("3");
      await panel.getByTestId("correct-laps-save").click();
      for (const d of all) await expect.poll(() => lapsOf(d, 302), { timeout: 20_000 }).toBe(3);
      await R.page.getByTestId("correct-status-DNF").click();
      for (const d of all) await expect.poll(() => statusOf(d, 302), { timeout: 20_000 }).toBe("DNF");
      await R.page.getByTestId("correct-status-clear").click();
      for (const d of all) await expect.poll(() => statusOf(d, 302), { timeout: 20_000 }).not.toBe("DNF");
      await R.page.getByTestId("correct-laps-undo").click();
      for (const d of all) await expect.poll(() => lapsOf(d, 302), { timeout: 20_000 }).toBe(1);
      await R.page.keyboard.press("Escape");
    });

    await test.step("Owner revokes the Counter mid-race: its offline taps are refused and listed", async () => {
      await C.page.goto(`/race/${C.race}/heat/1`);
      await expect(racingCard(C.page, 309)).toBeVisible();
      await goOffline(C);
      await tap(C.page, 309);
      await tap(C.page, 310);
      expect(await pending(C)).toBe(2);

      await A.page.goto(`/race/${A.race}/team`);
      const row = A.page.locator("li").filter({ hasText: email("Counter") });
      await row.getByRole("button", { name: "Remove" }).click();
      await expect(A.page.locator("li").filter({ hasText: email("Counter") })).toHaveCount(0);

      await goOnline(C);
      counterNotApplied += 2;
      await expect(C.page.getByTestId("sync-badge")).toContainText("No access", { timeout: 30_000 });
      await expect.poll(() => notApplied(C), { timeout: 30_000 }).toBe(counterNotApplied);
      await C.page.getByTestId("not-applied-open").click();
      await expect(C.page.getByTestId("rejected-item")).toHaveCount(counterNotApplied);
      await shot(C.page, "08-counter-revoked-not-applied");
      const server = await serverRiders();
      expect(server[309]).toBe("0|standing");
      expect(server[310]).toBe("0|standing");
      // A lap sent after the revocation (online) is refused too and listed; the server is unchanged.
      // (Finding: the device still lets the revoked judge tap — it is refused by the server, not blocked locally.)
      await C.page.evaluate(async ({ u, r }) => (await import("/src/app/services/live/liveClient.ts")).dispatchAction(u, "AddLap", { riderUuid: r }), { u: C.race, r: await riderUuid(C, 303) });
      counterNotApplied++;
      await expect.poll(() => notApplied(C), { timeout: 20_000 }).toBe(counterNotApplied);
      expect(await C.page.evaluate(async (u) => (await import("/src/app/services/live/liveClient.ts")).useLiveStore.getState().sync[u]?.notApplied.at(-1)?.reason, C.race)).toBe("not_member");
      expect((await serverRiders())[303]).toBe("1|standing");
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
      await C.ctx.close(); // the revoked Counter is done
    });

    await test.step("Board and Results are the same on every device and on the server", async () => {
      const server = await serverRiders(true);
      for (const d of [A, S, R]) {
        const mine = await ridersOn(d, true);
        for (const bib of WAVE1) expect(sameRider(mine[bib], server[bib]), `${d.who} bib ${bib}: ${mine[bib]} vs server ${server[bib]}`).toBe(true);
      }
      const order = async (d: Dev) => {
        await d.page.goto(`/race/${d.race}/results`);
        const block = d.page.getByTestId("results-category").filter({ hasText: "Elite" }).first();
        await expect(block).toContainText("Rider301");
        return (await block.innerText()).replace(/\s+/g, " ");
      };
      const ownerView = await order(A);
      await shot(A.page, "09-owner-results");
      expect(await order(S)).toBe(ownerView);
      expect(await order(R)).toBe(ownerView);
      const ownerBoard = await boardText(A);
      expect(ownerBoard.split(" | "), ownerBoard).toHaveLength(WAVE1.length);
      await shot(A.page, "10-owner-board");
      expect(await boardText(S)).toBe(ownerBoard);
      expect(await boardText(R)).toBe(ownerBoard);
    });
  } finally {
    for (const d of all) await d.ctx.close().catch(() => undefined);
  }
});
