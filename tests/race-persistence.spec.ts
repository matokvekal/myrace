import { test, expect, type Page } from "@playwright/test";
import { acceptTerms } from "./helpers";

/**
 * Create Race persistence and sign-in against a REAL Commissaire API (not run in CI).
 * Needs the app served with VITE_SERVER_URL=<api origin> and E2E_API_URL=<same origin>,
 * e.g. a local API on a throwaway database (server/test/support/pg-server.ts).
 */
const API_ORIGIN = process.env.E2E_API_URL;
const API = `${API_ORIGIN}/api/v1`;
test.skip(!API_ORIGIN, "needs a Commissaire API: set E2E_API_URL and serve the app with VITE_SERVER_URL");
const PASSWORD = "password-123";

async function register(page: Page, email: string, name = "Owner") {
  await page.getByRole("button", { name: "New account" }).click();
  await page.getByPlaceholder("Your name").fill(name);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/Password/).fill(PASSWORD);
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
