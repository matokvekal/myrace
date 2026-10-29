import { test, expect } from "@playwright/test";
import { acceptTerms, loadDemoRace, openTab } from "./helpers";

/**
 * Multi-language support (react-i18next). English lives inline as each
 * `t(key, "English default")` call's fallback; every other language is
 * fetched on demand from public/locales/<lng>/common.json only once the user
 * switches away from English.
 */
test.describe("i18n", () => {
  test("translation keys are flat strings, not nested-object paths", async ({ page }) => {
    // Regression test: the locale JSON files use flat dotted keys like
    // "scan.list" as literal property names. i18next's default keySeparator
    // treats "." as a nested-path separator, so without `keySeparator: false`
    // in src/app/i18n/i18n.ts, every lookup silently falls back to the English
    // default and no translation ever actually renders.
    await page.goto("/main");

    const resolved = await page.evaluate(async () => {
      const { default: i18n } = await import("/src/app/i18n/i18n.ts");
      await i18n.loadLanguages("es");
      return i18n.getFixedT("es")("scan.list", "Scan Start List");
    });

    expect(resolved).toBe("Escanear inicio");
  });

  test("Scan Start List is disabled with a Soon badge (empty Riders screen)", async ({ page }) => {
    // A race with no riders: Riders shows the import actions, Scan among them.
    await page.goto("/main");
    await acceptTerms(page);
    await page.reload();
    await page.getByRole("button", { name: /Create new race|^Add$/ }).first().click();
    await page.getByPlaceholder("Race Name").fill("Scan Check Race");
    await page.getByPlaceholder("Location").fill("Nowhere");
    await page.getByRole("button", { name: /Done|Saving/ }).click();
    await page.getByText("Scan Check Race").first().click();
    await openTab(page, "Riders");

    const scanItem = page.getByRole("button", { name: /Scan Start List/ });
    await expect(scanItem).toBeVisible();
    await expect(scanItem).toBeDisabled();
    await expect(scanItem.getByText("Soon")).toBeVisible();
  });

  test("switching language in the side menu updates visible UI text live", async ({ page }) => {
    await page.goto("/main");
    await acceptTerms(page);

    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByText("Register / Login")).toBeVisible();

    await page.getByTestId("prefs-language").click();
    await page.getByTestId("language-select").selectOption("es");

    // No remount required — react-i18next re-renders on the language-change
    // event, same requirement that drove boardHoldStore to be a zustand store
    // rather than component state.
    await expect(page.getByText("Registrarse / Iniciar sesión")).toBeVisible();
    await expect(page.getByText("Register / Login")).not.toBeVisible();
  });
});
