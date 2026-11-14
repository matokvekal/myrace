import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { acceptTerms, expectSignedIn } from "./helpers";

/**
 * Create Race persistence and sign-in against a REAL Commissaire API (not run in CI).
 * Needs the app served with VITE_SERVER_URL=<api origin> and E2E_API_URL=<same origin>,
 * e.g. the local API connected to the cloud database (it creates real test accounts and races).
 */
const API_ORIGIN = process.env.E2E_API_URL;
const API = `${API_ORIGIN}/api/v1`;
test.skip(!API_ORIGIN, "needs a Commissaire API: set E2E_API_URL and serve the app with VITE_SERVER_URL");
const PASSWORD = "password-123";

async function register(page: Page, email: string, name = "Owner") {
  await page.getByRole("tab", { name: "New account" }).click();
  await page.getByPlaceholder("Your name").fill(name);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/Password/).fill(PASSWORD);
  await page.getByPlaceholder("Repeat password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
}

async function serverRaces(email: string): Promise<string[]> {
  const login = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) })).json();
  const r = await (await fetch(`${API}/races`, { headers: { authorization: `Bearer ${login.accessToken}` } })).json();
  return r.races.map((x: { race: { name: string } }) => x.race.name);
}

async function createRace(page: Page, name: string) {
  await page.goto("/main");
  await page.getByRole("button", { name: /Create new race|Add/ }).first().click();
  await page.getByPlaceholder("Race Name").fill(name);
  await page.getByRole("button", { name: "Done" }).click();
}

test("signed in: Create Race waits for the server, and the race opens in a second browser", async ({ page, browser }) => {
  const email = `owner.${Date.now()}@x.test`;
  await page.goto("/main");
  await acceptTerms(page);
  await page.goto("/account");
  await register(page, email);
  await expect(page).toHaveURL(/\/main/, { timeout: 20_000 }); // signed in → All Races

  await createRace(page, "Phone Race");
  await expect(page.getByText("Race saved to the server")).toBeVisible();
  expect(await serverRaces(email)).toEqual(["Phone Race"]);

  // Another browser, same account: the race is listed from the server and opens.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await other.goto("/main");
  await acceptTerms(other);
  await other.goto("/account");
  await other.getByPlaceholder("Email").fill(email);
  await other.getByPlaceholder(/Password/).fill(PASSWORD);
  await other.getByRole("button", { name: "Sign in" }).click();
  // Signed in → All Races; the account's races are synced in (silently, AccountSync), listed once.
  await expectSignedIn(other);
  await expect(other.getByText("Phone Race").first()).toBeVisible({ timeout: 30_000 });
  await expect(other.getByText("Phone Race")).toHaveCount(1);
  await other.getByText("Phone Race").click();
  await expect(other).toHaveURL(/\/race\//);
  await expect(other.getByText("Phone Race").first()).toBeVisible();
  await ctx.close();
});

test("signed out: All Races needs an account; the Create Race link asks to sign in, syncs, then opens the form", async ({ page }) => {
  const email = `later.${Date.now()}@x.test`;
  await page.goto("/main");
  await acceptTerms(page);
  // Since 0.3 browsing needs an account (guests only open shared links): /main sends a guest to sign in.
  await page.goto("/main");
  await expect(page).toHaveURL(/\/account\?reason=guest&next=/);
  await expect(page.getByTestId("signin-reason-guest")).toBeVisible();
  // The app's own Create Race link for a signed-out user (main/page.tsx requestCreate).
  await page.goto(`/account?reason=create&next=${encodeURIComponent("/main?create=1")}`);
  await expect(page.getByTestId("signin-reason-create")).toContainText("to create a race");
  await register(page, email);
  // Straight on to Create Race, after the account's races were synced.
  await expect(page.getByPlaceholder("Race Name")).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder("Race Name").fill("After Login Race");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Race saved to the server")).toBeVisible();
  expect(await serverRaces(email)).toEqual(["After Login Race"]);
});

test("signed in, server unreachable: no local-only race is kept; Done again saves it once", async ({ page }) => {
  const email = `down.${Date.now()}@x.test`;
  await page.goto("/main");
  await acceptTerms(page);
  await page.goto("/account");
  await register(page, email);
  await expect(page).toHaveURL(/\/main$/);

  await page.route("**/api/v1/races/publish", (r) => r.abort("connectionrefused"));
  await createRace(page, "Down Race");
  await expect(page.getByTestId("save-error")).toContainText("not saved to the server");
  await expect(page.getByPlaceholder("Race Name")).toHaveValue("Down Race"); // the form stays, with its input
  expect(await serverRaces(email)).toEqual([]);

  await page.unroute("**/api/v1/races/publish");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Race saved to the server")).toBeVisible();
  expect(await serverRaces(email)).toEqual(["Down Race"]);
  await expect(page.getByText("Down Race")).toHaveCount(1); // exactly one, no leftover local copy
});

test("Create Race: when the account's races can't be synced, a clear error with Retry — and no race", async ({ page }) => {
  const email = `sync.${Date.now()}@x.test`;
  await page.goto("/main");
  await acceptTerms(page);
  await page.goto("/account");
  await register(page, email);
  await expect(page).toHaveURL(/\/main$/);
  await page.route("**/api/v1/races", (r) => (r.request().method() === "GET" ? r.fulfill({ status: 503, body: "down" }) : r.continue()));
  await page.getByRole("button", { name: /Create new race|Add/ }).first().click();
  await expect(page.getByTestId("create-race-gate")).toHaveAttribute("data-state", "error");
  await expect(page.getByPlaceholder("Race Name")).toHaveCount(0);
  await page.unroute("**/api/v1/races");
  await page.getByTestId("create-race-gate-retry").click();
  await expect(page.getByPlaceholder("Race Name")).toBeVisible({ timeout: 20_000 });
});

test("phone: Create Race signed out → sign in → form (mobile size)", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const email = `phone.${Date.now()}@x.test`;
  await page.goto("/main");
  await acceptTerms(page);
  // Signed out, a Create Race link (?create=1) goes through sign-in and continues to the form.
  await page.goto("/main?create=1");
  await expect(page).toHaveURL(/\/account\?reason=guest&next=/);
  await register(page, email);
  await expect(page.getByPlaceholder("Race Name")).toBeVisible({ timeout: 20_000 });
  await ctx.close();
});

const START_LIST = path.resolve(__dirname, "fixtures", "riders-import.csv"); // bibs 901–903, category "E2E Test Cat"

async function importFile(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  const empty = page.getByRole("button", { name: "Import CSV" });
  await expect(empty.or(page.getByTestId("rider-manage-btn")).first()).toBeVisible();
  if (await empty.isVisible().catch(() => false)) await empty.click();
  else {
    await page.getByTestId("rider-manage-btn").click();
    await page.getByRole("button", { name: "Import CSV" }).click();
  }
  await page.locator('input[type="file"][accept=".csv,.xlsx,.xls"]').setInputFiles(file);
  await page.getByRole("button", { name: "Continue to Preview" }).click();
  await page.getByTestId("preview-import").click();
}

async function snapshotOf(email: string) {
  const login = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) })).json();
  const auth = { authorization: `Bearer ${login.accessToken}` };
  const { races } = await (await fetch(`${API}/races`, { headers: auth })).json();
  return (await fetch(`${API}/races/${races[0].race.uuid}/snapshot`, { headers: auth })).json();
}

test("signed in: a start list imported into the new race goes to the server with its categories, once", async ({ page, browser }) => {
  const email = `import.${Date.now()}@x.test`;
  await page.goto("/main");
  await acceptTerms(page);
  await page.goto("/account");
  await register(page, email);
  await expect(page).toHaveURL(/\/main/, { timeout: 20_000 }); // signed in → All Races
  await createRace(page, "Import Race");
  await expect(page.getByText("Race saved to the server")).toBeVisible();
  await page.getByText("Import Race").first().click();
  await expect(page).toHaveURL(/\/race\//);

  await importFile(page, START_LIST);
  // Riders closes the wizard once the server confirmed; the list shows riders + category.
  await expect(page.getByText("McTestface Testy")).toBeVisible();
  await expect(page.getByText("E2E Test Cat").first()).toBeVisible();
  await expect(page.getByText(/Not applied/)).toHaveCount(0);
  let snap = await snapshotOf(email);
  expect(snap.riders.map((r: { bibNumber: number }) => r.bibNumber).sort()).toEqual([901, 902, 903]);
  expect(snap.categories.map((c: { name: string }) => c.name)).toEqual(["E2E Test Cat"]);

  // Phase 2: the same file again → its bibs are already in the race: the duplicate step opens
  // BEFORE anything is sent; Back cancels and nothing is added anywhere.
  await importFile(page, START_LIST);
  await expect(page.getByTestId("bib-group-901")).toContainText("Already in this race");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("preview-import")).toBeVisible();
  await page.getByRole("button", { name: "✕" }).click();
  snap = await snapshotOf(email);
  expect(snap.riders).toHaveLength(3);
  expect(snap.categories).toHaveLength(1);

  // A file with a duplicate bib: the organizer confirms 950 → 1950; one Action, audited on the server.
  await importFile(page, { name: "dup.csv", mimeType: "text/csv", buffer: Buffer.from("bib,first name,last name,category,heat\n950,A,One,Juniors,2\n950,B,Two,Juniors,2\n") });
  await expect(page.getByTestId("bib-choice-1")).toHaveValue("1950");
  await page.getByTestId("bib-conflicts-confirm").click();
  await expect(page.getByText("Riders (5)")).toBeVisible();
  snap = await snapshotOf(email);
  expect(snap.riders.map((r: { bibNumber: number }) => r.bibNumber).sort((a: number, b: number) => a - b)).toEqual([901, 902, 903, 950, 1950]);
  expect(snap.categories).toHaveLength(2);

  // A second browser sees the riders and the category.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await other.goto("/main");
  await acceptTerms(other);
  await other.goto("/account");
  await other.getByPlaceholder("Email").fill(email);
  await other.getByPlaceholder(/Password/).fill(PASSWORD);
  await other.getByRole("button", { name: "Sign in" }).click();
  // Synced in at sign-in (My Races syncs silently since 0.3; SharedRacesSection is no longer shown).
  await expect(other.getByText("Import Race").first()).toBeVisible({ timeout: 30_000 });
  await other.getByText("Import Race").first().click();
  await expect(other.getByText("McTestface").first()).toBeVisible();
  await other.getByRole("button", { name: "Categories", exact: true }).click();
  await expect(other.getByText("E2E Test Cat").first()).toBeVisible();
  await ctx.close();
});

test("side menu: shows the account; Logout signs out and keeps the races on this device", async ({ page }) => {
  // Since 0.3 a signed-out user never reaches the side menu (All Races needs an account), so the
  // menu's Login entry is covered by accountUi.test.tsx; here: sign in, a race on the device, Logout.
  await page.goto("/main");
  await acceptTerms(page);
  await page.goto("/account");
  await register(page, `menu.${Date.now()}@x.test`, "Menu User");
  await expectSignedIn(page);
  // A race on this device: the demo, offered on an empty My Races.
  await page.getByRole("button", { name: /Try Demo Race/i }).click();
  await page.waitForURL(/\/race\//);

  await page.goto("/main");
  await page.locator("#main-menu-button").click();
  await expect(page.getByText("Menu User").first()).toBeVisible();
  await page.getByTestId("menu-logout").click();
  await expect(page.getByText(/Signed out/)).toBeVisible();
  // Signed out: the session is gone, All Races asks to sign in again…
  await expect.poll(() => page.evaluate(() => localStorage.getItem("commissaire.live.session"))).toBeNull();
  await page.goto("/main");
  await expect(page).toHaveURL(/\/account\?reason=guest/);
  // …and the race is still on this device (IndexedDB), nothing was deleted.
  const names = await page.evaluate(async () => {
    const { getAllRacesFromDb } = await import("/src/app/stores/indexDb/indexedDbHelper.ts");
    return (await getAllRacesFromDb()).map((r: { name: string }) => r.name);
  });
  expect(names.some((n) => /Demo/i.test(n))).toBe(true);
});
