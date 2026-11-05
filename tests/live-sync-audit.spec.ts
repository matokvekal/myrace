import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { acceptTerms, checkInRow, finishedCard, gotoRaceMode, openRaceView, racingCard, setStatusAtCheckIn } from "./helpers";

/**
 * LIVE sync audit: ONE account on a PC and a phone at the same time, real API.
 * Creates its own test account + test race; touches nothing else. Measures how
 * long each change takes to show on the OTHER device without any refresh.
 *
 *   E2E_API_URL=https://commissaire.us E2E_BASE_URL=https://commissaire.us npx playwright test tests/live-sync-audit.spec.ts
 */
const API_ORIGIN = process.env.E2E_API_URL;
const API = `${API_ORIGIN}/api/v1`;
test.skip(!API_ORIGIN, "needs a Commissaire API (E2E_API_URL) and the app (E2E_BASE_URL)");
test.setTimeout(15 * 60_000);

const STAMP = Date.now();
const EMAIL = `sync-audit.${STAMP}@test.invalid`;
const PASSWORD = "sync-audit-password-1";
const RACE_NAME = `SYNC AUDIT ${STAMP}`;
const BIBS = Array.from({ length: 20 }, (_, i) => 201 + i);
const G_PC = BIBS.slice(0, 4); // laps recorded on the PC
const G_PHONE = BIBS.slice(4, 8); // laps recorded on the phone
const G_OFFLINE = BIBS.slice(8, 12); // PC records while the phone is offline
const SAME = BIBS[12]; // both tap the same rider at once
const [DIFF_A, DIFF_B] = [BIBS[13], BIBS[14]]; // both tap different riders at once
const DNS_BIB = BIBS[19];
const DNF_BIB = BIBS[15];
const DSQ_BIB = BIBS[16];

const metrics: Record<string, number> = {};
const frames = { pc: 0, phone: 0 };

function startList(): string {
  const rows = ["Bib,First Name,Last Name,Category,Start Time,Laps"];
  for (const bib of BIBS) rows.push(`${bib},Rider${bib},Audit${bib},${bib < 211 ? "Audit A" : "Audit B"},09:00,3`);
  const f = path.join(os.tmpdir(), `sync-audit-${STAMP}.csv`);
  fs.writeFileSync(f, rows.join("\n") + "\n", "utf8");
  return f;
}

async function device(browser: Browser, phone: boolean, key: "pc" | "phone"): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  page.on("websocket", (ws) => ws.on("framereceived", (f) => { if (String(f.payload).includes("race:changes")) frames[key]++; }));
  await page.goto("/main");
  await acceptTerms(page);
  return { ctx, page };
}

/** Time from now until `probe` returns true on the other device (polled every 50 ms, no refresh). */
async function timeUntil(label: string, probe: () => Promise<boolean>, timeout = 60_000) {
  const t0 = Date.now();
  await expect.poll(probe, { intervals: [50], timeout, message: label }).toBe(true);
  metrics[label] = Date.now() - t0;
}

const lapsOf = async (page: Page, bib: number) => (await racingCard(page, bib).getAttribute("data-laps").catch(() => null)) ?? (await finishedCard(page, bib).count() ? "finished" : "none");
const tap = async (page: Page, bib: number) => {
  await racingCard(page, bib).click();
  await page.waitForTimeout(450); // single vs double tap window
};

let token = "";
async function serverSnapshot() {
  if (!token) token = (await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json()).accessToken;
  const h = { authorization: `Bearer ${token}` };
  const { races } = await (await fetch(`${API}/races`, { headers: h })).json();
  const mine = races.filter((r: { race: { name: string } }) => r.race.name === RACE_NAME);
  expect(mine).toHaveLength(1);
  const uuid = mine[0].race.uuid;
  const snap = await (await fetch(`${API}/races/${uuid}/snapshot`, { headers: h })).json();
  const hist = await (await fetch(`${API}/races/${uuid}/history?limit=1000`, { headers: h })).json();
  return { snap, events: hist.events as { type: string; applied: boolean; serverReceivedAt?: string; eventAt?: string }[] };
}

test("one account, PC + phone: live sync of check-in, start, laps, statuses, offline recovery, simultaneous taps, finish", async ({ browser }) => {
  const pc = await device(browser, false, "pc");
  const phone = await device(browser, true, "phone");

  await test.step("PC: test account + test race (20 riders, one wave)", async () => {
    await pc.page.goto("/account");
    await pc.page.getByRole("tab", { name: "New account" }).click();
    await pc.page.getByPlaceholder("Your name").fill("Sync Audit");
    await pc.page.getByPlaceholder("Email").fill(EMAIL);
    await pc.page.getByPlaceholder("Password (8+ characters)").fill(PASSWORD);
    await pc.page.getByPlaceholder("Repeat password").fill(PASSWORD);
    await pc.page.getByRole("button", { name: "Create account" }).click();
    await expect(pc.page.getByRole("button", { name: "Sign out" }).or(pc.page.locator("text=All Races")).first()).toBeVisible({ timeout: 20_000 });
    await pc.page.goto("/main");
    await pc.page.getByRole("button", { name: /Create new race|Add/ }).first().click();
    await pc.page.getByPlaceholder("Race Name").fill(RACE_NAME);
    await pc.page.locator("#ridersFileUpload").setInputFiles(startList());
    await pc.page.getByTestId("import-preview-confirm").check();
    await pc.page.getByRole("button", { name: "Done" }).click();
    await expect(pc.page.getByText(/saved to the server/i)).toBeVisible({ timeout: 30_000 });
    // The race card under My Races (an older build also lists it under "My shared races", which doesn't navigate).
    await pc.page.getByText(RACE_NAME).last().click();
    await pc.page.waitForURL(/\/race\/[^/]+$/);
  });

  await test.step("phone: same account opens the same race", async () => {
    await phone.page.goto("/account");
    await phone.page.getByPlaceholder("Email").fill(EMAIL);
    await phone.page.getByPlaceholder(/Password/).fill(PASSWORD);
    await phone.page.getByRole("button", { name: "Sign in" }).click();
    await expect(phone.page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 20_000 }); // signed in (this build stays on the account page)
    const row = phone.page.locator("li").filter({ hasText: RACE_NAME }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole("button", { name: "Open" }).click();
    await expect(phone.page).toHaveURL(/\/race\//, { timeout: 30_000 });
  });

  await test.step("Check-In on PC → phone; DNS on phone → PC", async () => {
    await openRaceView(phone.page, "Check-In");
    await openRaceView(pc.page, "Check-In");
    await pc.page.getByTestId("checkin-check-all").click();
    await timeUntil("check-in all: PC → phone", async () => (await phone.page.locator('[data-testid^="checkin-row-"][data-checked="yes"]').count()) === BIBS.length);
    await setStatusAtCheckIn(phone.page, DNS_BIB, "DNS");
    await timeUntil("DNS: phone → PC", async () => (await checkInRow(pc.page, DNS_BIB).getAttribute("data-status")) === "DNS");
  });

  await test.step("start the wave on PC → phone's Live shows the cards", async () => {
    await gotoRaceMode(phone.page, "Live");
    await openRaceView(pc.page, "Grid");
    const blocks = pc.page.getByTestId("simple-start-group");
    await blocks.first().getByTestId("start-all").click({ force: true });
    await timeUntil("wave start: PC → phone (cards on Live)", async () => (await phone.page.locator('[data-testid^="racing-rider-"]').count()) === BIBS.length - 1);
    await gotoRaceMode(pc.page, "Live");
    await expect(pc.page.locator('[data-testid^="racing-rider-"]')).toHaveCount(BIBS.length - 1, { timeout: 20_000 });
  });

  await test.step("laps on phone → PC, laps on PC → phone (no refresh)", async () => {
    for (const bib of G_PHONE) await tap(phone.page, bib);
    await timeUntil("laps: phone → PC", async () => {
      for (const bib of G_PHONE) if (!String(await lapsOf(pc.page, bib)).startsWith("1/")) return false;
      return true;
    });
    for (const bib of G_PC) await tap(pc.page, bib);
    await timeUntil("laps: PC → phone", async () => {
      for (const bib of G_PC) if (!String(await lapsOf(phone.page, bib)).startsWith("1/")) return false;
      return true;
    });
  });

  await test.step("DNF on phone → PC, DSQ on PC → phone", async () => {
    await racingCard(phone.page, DNF_BIB).dblclick();
    await phone.page.getByRole("button", { name: "DNF", exact: true }).click();
    await timeUntil("DNF: phone → PC", async () => (await finishedCard(pc.page, DNF_BIB).getAttribute("data-status").catch(() => null)) === "DNF");
    await racingCard(pc.page, DSQ_BIB).dblclick();
    await pc.page.getByRole("button", { name: "DSQ", exact: true }).click();
    await timeUntil("DSQ: PC → phone", async () => (await finishedCard(phone.page, DSQ_BIB).getAttribute("data-status").catch(() => null)) === "DSQ");
  });

  await test.step("phone offline while the PC records laps → reconnect recovers everything", async () => {
    await phone.ctx.setOffline(true);
    for (const bib of G_OFFLINE) await tap(pc.page, bib);
    await pc.page.waitForTimeout(4000);
    for (const bib of G_OFFLINE) expect(await lapsOf(phone.page, bib), `phone offline must not have ${bib} yet`).toMatch(/^0\//);
    await phone.ctx.setOffline(false);
    await timeUntil("recovery after reconnect: PC laps → phone", async () => {
      for (const bib of G_OFFLINE) if (!String(await lapsOf(phone.page, bib)).startsWith("1/")) return false;
      return true;
    }, 120_000);
  });

  await test.step("simultaneous taps: same rider on both (one lap), different riders (both kept)", async () => {
    await Promise.all([racingCard(pc.page, SAME).click(), racingCard(phone.page, SAME).click()]);
    await Promise.all([racingCard(pc.page, DIFF_A).click(), racingCard(phone.page, DIFF_B).click()]);
    await pc.page.waitForTimeout(500);
    await timeUntil("simultaneous: both devices agree", async () => {
      for (const p of [pc.page, phone.page]) {
        for (const bib of [SAME, DIFF_A, DIFF_B]) if (!String(await lapsOf(p, bib)).startsWith("1/")) return false;
      }
      return true;
    });
  });

  await test.step("Finish Wave on PC → phone", async () => {
    await pc.page.getByTestId("finish-wave-btn").click();
    await pc.page.getByPlaceholder("FINISH").fill("FINISH");
    await pc.page.getByRole("button", { name: /Confirm Finish|Finish Wave/ }).last().click();
    await timeUntil("finish wave: PC → phone", async () => (await phone.page.getByTestId("wave-finished-tag").count()) > 0, 60_000);
  });

  await test.step("server truth: every lap once, statuses, no duplicates", async () => {
    const { snap, events } = await serverSnapshot();
    const byBib = new Map((snap.riders as { bibNumber: number; lapsCounter: number; status: string; uuid: string }[]).map((r) => [r.bibNumber, r]));
    expect(snap.riders).toHaveLength(BIBS.length);
    expect(new Set(snap.riders.map((r: { uuid: string }) => r.uuid)).size).toBe(BIBS.length);
    for (const bib of [...G_PC, ...G_PHONE, ...G_OFFLINE, SAME, DIFF_A, DIFF_B]) expect(byBib.get(bib)!.lapsCounter, `bib ${bib}`).toBe(1);
    expect(byBib.get(DNS_BIB)!.status).toBe("DNS");
    expect(byBib.get(DNF_BIB)!.status).toBe("DNF");
    expect(byBib.get(DSQ_BIB)!.status).toBe("DSQ");
    const addLaps = events.filter((e) => e.type === "AddLap");
    metrics["server: AddLap events (both taps of SAME kept in the log)"] = addLaps.length;
    metrics["server: AddLap applied"] = addLaps.filter((e) => e.applied).length;
    const lags = events.filter((e) => e.serverReceivedAt && e.eventAt).map((e) => new Date(e.serverReceivedAt!).getTime() - new Date(e.eventAt!).getTime());
    if (lags.length) {
      lags.sort((a, b) => a - b);
      metrics["tap → stored in PostgreSQL, median ms"] = lags[Math.floor(lags.length / 2)];
      metrics["tap → stored in PostgreSQL, max ms"] = lags[lags.length - 1];
    }
  });

  metrics["socket race:changes frames received (PC)"] = frames.pc;
  metrics["socket race:changes frames received (phone)"] = frames.phone;
  fs.writeFileSync(test.info().outputPath("sync-metrics.json"), JSON.stringify(metrics, null, 2));
  console.log("SYNC-METRICS " + JSON.stringify(metrics));
  await pc.ctx.close();
  await phone.ctx.close();
});
