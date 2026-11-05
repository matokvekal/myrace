import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { acceptTerms } from "./helpers";

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
  // Signed in → All Races; the account's races are synced in, listed once.
  await expect(other.getByTestId("shared-races-synced")).toBeVisible({ timeout: 30_000 });
  await expect(other.getByText("Phone Race")).toHaveCount(1);
  await other.getByText("Phone Race").click();
  await expect(other).toHaveURL(/\/race\//);
  await expect(other.getByText("Phone Race").first()).toBeVisible();
  await ctx.close();
});

test("signed out: browsing works; Create Race asks to sign in, syncs the account's races, then opens the form", async ({ page }) => {
  const email = `later.${Date.now()}@x.test`;
  await page.goto("/main");
  await acceptTerms(page);
  await page.goto("/main");
  await expect(page.getByRole("button", { name: /Try Demo Race/i })).toBeVisible(); // public browsing, no account
  await page.getByRole("button", { name: /Create new race|Add/ }).first().click();
  await expect(page).toHaveURL(/\/account\?reason=create&next=/);
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
  await page.goto("/main");
  await page.getByRole("button", { name: /Create new race|Add/ }).first().click();
  await expect(page.getByTestId("signin-reason-create")).toBeVisible();
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

  // The same file again, and a file with a duplicate bib: refused by row, nothing added anywhere.
  await importFile(page, START_LIST);
  await expect(page.getByTestId("import-refused")).toContainText("Row 1: bib 901 is already in this race"); // rows numbered as in the import preview
  await page.getByRole("button", { name: "Close" }).click();
  await importFile(page, { name: "dup.csv", mimeType: "text/csv", buffer: Buffer.from("bib,first name,last name,category,heat\n950,A,One,Juniors,2\n950,B,Two,Juniors,2\n") });
  await expect(page.getByTestId("import-refused")).toContainText("Bib 950 appears on rows 1, 2");
  await page.getByRole("button", { name: "Close" }).click();
  snap = await snapshotOf(email);
  expect(snap.riders).toHaveLength(3);
  expect(snap.categories).toHaveLength(1);
  await expect(page.getByText("Riders (3)")).toBeVisible();

  // A second browser sees the riders and the category.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await other.goto("/main");
  await acceptTerms(other);
  await other.goto("/account");
  await other.getByPlaceholder("Email").fill(email);
  await other.getByPlaceholder(/Password/).fill(PASSWORD);
  await other.getByRole("button", { name: "Sign in" }).click();
  await expect(other.getByTestId("shared-races-synced")).toBeVisible({ timeout: 30_000 }); // synced in at sign-in, listed once
  await other.getByText("Import Race").first().click();
  await expect(other.getByText("McTestface").first()).toBeVisible();
  await other.getByRole("button", { name: "Categories", exact: true }).click();
  await expect(other.getByText("E2E Test Cat").first()).toBeVisible();
  await ctx.close();
});

test("side menu: Register / Login opens /account; Logout signs out and keeps local races", async ({ page }) => {
  await page.goto("/main");
  await acceptTerms(page);
  // A race on this device (the demo: creating one now needs an account).
  await page.getByRole("button", { name: /Try Demo Race/i }).click();
  await page.waitForURL(/\/race\//);
  await page.goto("/main");
  await page.locator("#main-menu-button").click();
  await page.getByTestId("menu-login").click();
  await expect(page).toHaveURL(/\/account$/);
  await register(page, `menu.${Date.now()}@x.test`, "Menu User");
  await expect(page).toHaveURL(/\/main/, { timeout: 20_000 }); // signed in → All Races

  await page.goto("/main");
  await page.locator("#main-menu-button").click();
  await expect(page.getByText("Menu User").first()).toBeVisible();
  await page.getByTestId("menu-logout").click();
  await expect(page.getByText(/Signed out/)).toBeVisible();
  await page.locator("#main-menu-button").click();
  await expect(page.getByTestId("menu-login")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Demo Race").first()).toBeVisible();
});
