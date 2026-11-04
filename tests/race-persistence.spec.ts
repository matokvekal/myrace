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
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

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
  await expect(other.getByText("Phone Race")).toBeVisible();
  await other.getByRole("button", { name: "Open" }).click();
  await expect(other).toHaveURL(/\/race\//);
  await expect(other.getByText("Phone Race").first()).toBeVisible();
  await ctx.close();
});

test("signed out: local only, nothing uploads on sign-in, 'Save to server' does", async ({ page }) => {
  const email = `later.${Date.now()}@x.test`;
  await page.goto("/main");
  await acceptTerms(page);
  await createRace(page, "Offline Race");
  await expect(page.getByText(/Race saved on this device only/)).toBeVisible();

  await page.getByText("Offline Race").first().click();
  const badge = page.getByTestId("local-only-badge");
  await expect(badge).toHaveAttribute("data-state", "signed-out");
  await page.getByTestId("local-only-signin").click();
  await expect(page).toHaveURL(/\/account\?next=/);
  await register(page, email);

  // Back on the race, signed in: still local — no automatic upload.
  await expect(page).toHaveURL(/\/race\//);
  await expect(badge).toHaveAttribute("data-state", "local");
  await page.waitForTimeout(2000);
  expect(await serverRaces(email)).toEqual([]);

  await page.getByTestId("local-only-save").click();
  await expect(page.getByText("Race saved to the server")).toBeVisible();
  await expect(badge).toHaveCount(0);
  expect(await serverRaces(email)).toEqual(["Offline Race"]);
});

test("signed in, server unreachable: says device only with the reason, then uploads when it is back", async ({ page }) => {
  const email = `down.${Date.now()}@x.test`;
  await page.goto("/main");
  await acceptTerms(page);
  await page.goto("/account");
  await register(page, email);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.route("**/api/v1/races/publish", (r) => r.abort("connectionrefused"));
  await createRace(page, "Down Race");
  await expect(page.getByText("Race saved on this device only. No connection to the server.")).toBeVisible();
  expect(await serverRaces(email)).toEqual([]);

  await page.getByText("Down Race").first().click();
  const badge = page.getByTestId("local-only-badge");
  await expect(badge).toHaveAttribute("data-state", "failed");
  await expect(badge).toContainText("No connection to the server");

  await page.unroute("**/api/v1/races/publish");
  await page.getByTestId("local-only-save").click();
  await expect(page.getByText("Race saved to the server")).toBeVisible();
  await expect(badge).toHaveCount(0);
  expect(await serverRaces(email)).toEqual(["Down Race"]);
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
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await createRace(page, "Import Race");
  await expect(page.getByText("Race saved to the server")).toBeVisible();
  await page.getByText("Import Race").last().click(); // the race card (first is the shared-races list)
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
  await other.getByRole("button", { name: "Open" }).click();
  await expect(other.getByText("McTestface").first()).toBeVisible();
  await other.getByRole("button", { name: "Categories", exact: true }).click();
  await expect(other.getByText("E2E Test Cat").first()).toBeVisible();
  await ctx.close();
});

test("side menu: Register / Login opens /account; Logout signs out and keeps local races", async ({ page }) => {
  await page.goto("/main");
  await acceptTerms(page);
  await createRace(page, "Kept Race");
  await page.locator("#main-menu-button").click();
  await page.getByTestId("menu-login").click();
  await expect(page).toHaveURL(/\/account$/);
  await register(page, `menu.${Date.now()}@x.test`, "Menu User");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await page.goto("/main");
  await page.locator("#main-menu-button").click();
  await expect(page.getByText("Menu User").first()).toBeVisible();
  await page.getByTestId("menu-logout").click();
  await expect(page.getByText(/Signed out/)).toBeVisible();
  await page.locator("#main-menu-button").click();
  await expect(page.getByTestId("menu-login")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Kept Race").first()).toBeVisible();
});
