import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Commissaire E2E tests.
 * Boots the Vite dev server (port 3000) and drives the app in Chromium.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3000",
    // Bound each action so a wrong selector fails in seconds instead of eating
    // the whole test timeout (the full-race spec runs for minutes).
    actionTimeout: 15_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // The app registers a service worker; block it so tests always hit fresh code.
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
