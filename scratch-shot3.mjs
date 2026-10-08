import { chromium } from "playwright";

const browser = await chromium.launch();

for (const width of [375, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 800 } });

  await page.goto("http://localhost:3000/main");
  await page.evaluate(() => {
    localStorage.setItem(
      "termsAcceptance",
      JSON.stringify({ version: "__any__", acceptedAt: new Date().toISOString() })
    );
  });
  await page.reload();

  const demoBtn = page.getByRole("button", { name: /Try Demo Race/i });
  await demoBtn.waitFor({ state: "visible", timeout: 15000 });
  await demoBtn.click();
  await page.waitForURL(/\/race\/demo-race-99001/, { timeout: 15000 });

  try {
    await page.waitForURL(/\/heat\//, { timeout: 5000 });
  } catch {
    const liveTab = page.getByRole("tab", { name: "Live", exact: true });
    if (await liveTab.isVisible().catch(() => false)) {
      await liveTab.click();
      await page.waitForURL(/\/heat\//, { timeout: 15000 });
    }
  }

  await page.waitForTimeout(1200);
  const header = page.locator('[class*="headerRace"]').first();
  await header.screenshot({ path: `shot-header-${width}.png` });
  await page.close();
}

await browser.close();
console.log("done");
