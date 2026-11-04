import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { acceptTerms, checkInRow, finishedCard, gotoRaceMode, openRaceView, racingCard, setStatusAtCheckIn } from "./helpers";

/**
 * PC ↔ mobile synchronization against a REAL Commissaire API + cloud PostgreSQL (not in CI).
 * Creates its own test account and test race; touches nothing else.
 *
 *   API:  PORT=4100 CORS_ORIGINS=http://localhost:3100 npx tsx src/server.ts   (in server/)
 *   App:  VITE_SERVER_URL=http://localhost:4100 npx vite --port 3100
 *   Run:  E2E_API_URL=http://localhost:4100 E2E_BASE_URL=http://localhost:3100 npx playwright test tests/cloud-sync.spec.ts
 *
 * The start list has NO wave column (waves come from start times): exactly the case
 * where the server used to start nothing and rider cards went missing.
 */
const API_ORIGIN = process.env.E2E_API_URL;
const API = `${API_ORIGIN}/api/v1`;
test.skip(!API_ORIGIN, "needs a Commissaire API: set E2E_API_URL and serve the app with VITE_SERVER_URL");
test.setTimeout(15 * 60_000);
// Server-side waits. Local API → cloud DB is ~120 ms per query, so a batch of laps can take
// a minute here; on the production server (API next to the DB) it is well under a second.
const SYNC_MS = Number(process.env.E2E_SYNC_MS ?? 180_000);

const PASSWORD = "sync-test-password-1";
const STAMP = Date.now();
const EMAIL = `sync-e2e.${STAMP}@test.invalid`;
const RACE_NAME = `SYNC E2E ${STAMP}`;

// 40 riders, 4 categories, 3 start times 5 min apart → one wave derived from start times.
const CATS = [
  { name: "Sync Kids", start: "09:00" },
  { name: "Sync Girls", start: "09:00" },
  { name: "Sync Youth", start: "09:05" },
  { name: "Sync Elite", start: "09:10" },
];
const BIBS = Array.from({ length: 40 }, (_, i) => 101 + i);
const catOf = (bib: number) => CATS[Math.floor((bib - 101) / 10)];
const DNS_BIB = 140;
const DNF_BIB = 101;
const DSQ_BIB = 102; // set on the PC, must reach the phone

function startListFile(): string {
  const rows = ["Bib,First Name,Last Name,Category,Start Time,Laps"];
  for (const bib of BIBS) rows.push(`${bib},Rider${bib},Sync${bib},${catOf(bib).name},${catOf(bib).start},2`);
  const file = path.join(os.tmpdir(), `sync-e2e-${STAMP}.csv`);
  fs.writeFileSync(file, rows.join("\n") + "\n", "utf8");
  return file;
}

// ── Server side (the truth both devices must match) ─────────────────────────

let token = "";
async function apiGet<T>(p: string): Promise<T> {
  if (!token) {
    const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
    token = (await r.json()).accessToken;
  }
  const r = await fetch(API + p, { headers: { authorization: `Bearer ${token}` } });
  expect(r.ok, `${p} → ${r.status}`).toBe(true);
  return (await r.json()) as T;
}
type SRider = { uuid: string; bibNumber: number; status: string; raceStatus: string; lapsCounter: number; timeStartRace: string | null; category: string };
type SCat = { name: string; heat: number | null; status: string; startTime: string | null };
async function serverRace() {
  const { races } = await apiGet<{ races: { race: { uuid: string; name: string } }[] }>("/races");
  const mine = races.filter((r) => r.race.name === RACE_NAME);
  expect(mine, "exactly one server race for the test race").toHaveLength(1);
  const snap = await apiGet<{ riders: SRider[]; categories: SCat[] }>(`/races/${mine[0].race.uuid}/snapshot`);
  return { uuid: mine[0].race.uuid, riders: snap.riders, categories: snap.categories };
}

// ── UI helpers ──────────────────────────────────────────────────────────────

async function freshDevice(browser: Browser, mobile: boolean): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/main");
  await acceptTerms(page);
  return { ctx, page };
}

async function signIn(page: Page) {
  await page.goto("/account");
  await page.getByPlaceholder("Email").fill(EMAIL);
  await page.getByPlaceholder(/Password/).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/main/, { timeout: 20_000 }); // signed in → All Races
}

/** Open the test race from the account's shared races (same path a second phone takes). */
async function openFromAccount(page: Page) {
  await page.goto("/account");
  const row = page.locator("li, [class*='item']").filter({ hasText: RACE_NAME }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/race\//, { timeout: 30_000 });
}

/** Bibs on the Live racing grid. */
async function racingBibs(page: Page): Promise<number[]> {
  const ids = await page.locator('[data-testid^="racing-rider-"]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.testid ?? ""));
  return ids.map((id) => Number(id.replace("racing-rider-", ""))).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
}

async function openLive(page: Page) {
  await gotoRaceMode(page, "Live");
  await page.waitForURL(/\/heat\/1$/, { timeout: 20_000 });
}

test("PC creates, phone runs the race, both stay in sync; logout + cleared storage loses nothing", async ({ browser }) => {
  const pc = await freshDevice(browser, false);
  const phone = await freshDevice(browser, true);

  await test.step("PC: register a test account and create the test race from a start list", async () => {
    await pc.page.goto("/account");
    await pc.page.getByRole("tab", { name: "New account" }).click();
    await pc.page.getByPlaceholder("Your name").fill("Sync Tester");
    await pc.page.getByPlaceholder("Email").fill(EMAIL);
    await pc.page.getByPlaceholder("Password (8+ characters)").fill(PASSWORD);
    await pc.page.getByPlaceholder("Repeat password").fill(PASSWORD);
    await pc.page.getByRole("button", { name: "Create account" }).click();
    await expect(pc.page).toHaveURL(/\/main/, { timeout: 20_000 }); // signed in → All Races

    await pc.page.goto("/main");
    await pc.page.getByRole("button", { name: /Create new race|Add/ }).first().click();
    await pc.page.getByPlaceholder("Race Name").fill(RACE_NAME);
    await pc.page.locator("#ridersFileUpload").setInputFiles(startListFile());
    await expect(pc.page.getByTestId("import-preview")).toContainText("40 riders · 4 categories · waves from start times");
    await pc.page.getByTestId("import-preview-confirm").check();
    await pc.page.getByRole("button", { name: "Done" }).click();
    await expect(pc.page.getByText(/saved to the server/i)).toBeVisible({ timeout: 30_000 });
  });

  await test.step("server: 40 riders, 4 categories, nothing started", async () => {
    await expect.poll(async () => (await serverRace()).riders.length, { timeout: 30_000 }).toBe(40);
    const s = await serverRace();
    expect(s.categories.map((c) => c.name).sort()).toEqual(CATS.map((c) => c.name).sort());
    expect(new Set(s.riders.map((r) => r.bibNumber)).size).toBe(40);
    expect(s.riders.every((r) => r.raceStatus === "upcoming")).toBe(true);
  });

  await test.step("phone: same account sees the race with every rider, category and wave", async () => {
    await signIn(phone.page);
    await openFromAccount(phone.page);
    await gotoRaceMode(phone.page, "Create");
    await phone.page.getByRole("button", { name: "Riders", exact: true }).click();
    await expect(phone.page.getByText("Riders (40)")).toBeVisible({ timeout: 30_000 });
    await expect(phone.page.getByTestId("riders-valid-count")).toHaveText(/40 valid/);
    await expect(phone.page.getByTestId("wave-group-1")).toBeVisible();
  });

  await test.step("phone: check in, one DNS, start every start of wave 1", async () => {
    await openRaceView(phone.page, "Check-In");
    await phone.page.getByTestId("checkin-check-all").click();
    await expect(phone.page.getByTestId("checkin-check-all")).toHaveCount(0);
    await setStatusAtCheckIn(phone.page, DNS_BIB, "DNS");
    await expect(checkInRow(phone.page, DNS_BIB)).toHaveAttribute("data-status", "DNS");
    await openRaceView(phone.page, "Grid");
    const blocks = phone.page.getByTestId("simple-start-group");
    await expect(blocks).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await blocks.nth(i).getByTestId("start-all").click();
      await expect(blocks.nth(i).getByText(/Started/)).toBeVisible({ timeout: 15_000 });
    }
  });

  await test.step("phone Live: every started rider has a card; one lap each; one DNF", async () => {
    await openLive(phone.page);
    const started = BIBS.filter((b) => b !== DNS_BIB);
    await expect.poll(() => racingBibs(phone.page), { timeout: 20_000 }).toEqual(started);
    for (const bib of started) {
      await racingCard(phone.page, bib).click();
      await phone.page.waitForTimeout(450); // single vs double tap window
    }
    await racingCard(phone.page, DNF_BIB).dblclick().catch(async () => finishedCard(phone.page, DNF_BIB).dblclick());
    await expect(phone.page.getByText("Note / Comment")).toBeVisible();
    await phone.page.getByRole("button", { name: "DNF", exact: true }).click();
    await expect(finishedCard(phone.page, DNF_BIB)).toHaveAttribute("data-status", "DNF", { timeout: 15_000 });
  });

  await test.step("server: wave 1 started there too, laps and statuses arrived", async () => {
    await expect.poll(async () => (await serverRace()).riders.filter((r) => r.lapsCounter === 1).length, { timeout: SYNC_MS }).toBe(39);
    const s = await serverRace();
    for (const c of s.categories) expect(c, c.name).toMatchObject({ heat: 1, status: "running" });
    const byBib = new Map(s.riders.map((r) => [r.bibNumber, r]));
    expect(byBib.get(DNS_BIB)).toMatchObject({ status: "DNS", lapsCounter: 0 });
    expect(byBib.get(DNF_BIB)!.status).toBe("DNF");
    expect(s.riders.filter((r) => r.bibNumber !== DNS_BIB).every((r) => r.raceStatus !== "upcoming" && r.timeStartRace)).toBe(true);
  });

  await test.step("PC: sees the phone's start, laps and statuses; marks a DSQ", async () => {
    await pc.page.goto("/main");
    await pc.page.getByText(RACE_NAME).first().click();
    await pc.page.waitForURL(/\/race\/[^/]+$/);
    await openLive(pc.page);
    const expected = BIBS.filter((b) => b !== DNS_BIB && b !== DNF_BIB);
    await expect.poll(() => racingBibs(pc.page), { timeout: SYNC_MS }).toEqual(expected);
    await expect(finishedCard(pc.page, DNF_BIB)).toHaveAttribute("data-status", "DNF");
    await racingCard(pc.page, DSQ_BIB).dblclick();
    await expect(pc.page.getByText("Note / Comment")).toBeVisible();
    await pc.page.getByRole("button", { name: "DSQ", exact: true }).click();
    await expect(finishedCard(pc.page, DSQ_BIB)).toHaveAttribute("data-status", "DSQ", { timeout: 15_000 });
    await expect.poll(async () => (await serverRace()).riders.find((r) => r.bibNumber === DSQ_BIB)!.status, { timeout: SYNC_MS }).toBe("DSQ");
  });

  await test.step("phone: gets the PC's DSQ", async () => {
    await expect(finishedCard(phone.page, DSQ_BIB)).toHaveAttribute("data-status", "DSQ", { timeout: SYNC_MS });
  });

  await test.step("phone: log out, clear all storage, sign in again — every started rider is back", async () => {
    await phone.page.goto("/main");
    await phone.page.getByRole("button", { name: "Open menu" }).click();
    await phone.page.getByTestId("menu-logout").click();
    await phone.page.evaluate(async () => {
      localStorage.clear();
      sessionStorage.clear();
      const dbs = (await indexedDB.databases?.()) ?? [];
      await Promise.all(dbs.map((d) => new Promise((res) => { const r = indexedDB.deleteDatabase(d.name!); r.onsuccess = r.onerror = r.onblocked = () => res(null); })));
    });
    await phone.ctx.clearCookies();
    await phone.page.goto("/main");
    await acceptTerms(phone.page);
    await signIn(phone.page);
    await openFromAccount(phone.page);
    await openLive(phone.page);
    const onTrack = BIBS.filter((b) => ![DNS_BIB, DNF_BIB, DSQ_BIB].includes(b));
    await expect.poll(() => racingBibs(phone.page), { timeout: SYNC_MS }).toEqual(onTrack);
    await expect(finishedCard(phone.page, DNF_BIB)).toHaveAttribute("data-status", "DNF");
    await expect(finishedCard(phone.page, DSQ_BIB)).toHaveAttribute("data-status", "DSQ");
    await expect(racingCard(phone.page, DNS_BIB)).toHaveCount(0);
  });

  await test.step("results: phone and server agree (1 lap each, no duplicates)", async () => {
    const s = await serverRace();
    expect(s.riders).toHaveLength(40);
    expect(new Set(s.riders.map((r) => r.uuid)).size).toBe(40);
    await gotoRaceMode(phone.page, "Results");
    for (const bib of [103, 120, 139]) await expect(phone.page.getByTestId("bib").filter({ hasText: new RegExp(`^${bib}$`) }).first()).toBeVisible({ timeout: 20_000 });
  });

  await pc.ctx.close();
  await phone.ctx.close();
});
