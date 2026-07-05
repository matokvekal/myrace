const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.createContext({
    viewport: { width: 375, height: 667 } // Mobile viewport
  });
  const page = await context.newPage();

  try {
    await page.goto('http://localhost:5173');

    // Wait for app to load
    await page.waitForSelector('[class*="races"]', { timeout: 5000 }).catch(() => {});

    // Take screenshot
    await page.screenshot({ path: 'mobile-view.png' });
    console.log('✓ Mobile screenshot saved as mobile-view.png');

    // Check if CSV import modal structure is present in the DOM
    const hasModalStructure = await page.evaluate(() => {
      return document.querySelectorAll('[class*="wizard"], [class*="csv"]').length > 0;
    });

    console.log('✓ Modal structure exists:', hasModalStructure);

  } catch (error) {
    console.error('Test failed:', error.message);
  } finally {
    await browser.close();
  }
})();
