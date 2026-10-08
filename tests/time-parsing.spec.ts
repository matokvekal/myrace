import { test, expect } from "@playwright/test";

/**
 * `parseClockTime` is now the single time parser (BUGS.md #26) — five hand-rolled
 * copies used to live on the live screens, and a sixth in Results used
 * `new Date()` and produced NaN for every finisher (BUGS.md #30).
 *
 * Exercised in the browser so it runs against the real shipped module.
 */
test.describe("Shared clock-time parsing", () => {
  test("parses the formats the app actually stores", async ({ page }) => {
    await page.goto("/main");

    const results = await page.evaluate(async () => {
      const mod = await import("/src/app/utils/timeUtils.ts");
      const { parseClockTime, parseClockTimeMs } = mod as {
        parseClockTime: (t: string | null | undefined) => Date | null;
        parseClockTimeMs: (t: string | null | undefined) => number | null;
      };

      const hm = (t: string) => {
        const d = parseClockTime(t);
        return d ? `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}` : null;
      };

      return {
        // Scheduled start times from the start list.
        t0800: hm("08:00"),
        t0810: hm("08:10"),
        t0920: hm("09:20"),
        // Actual start stamped by StartManager (toLocaleTimeString, HH:MM:SS).
        withSeconds: hm("08:04:31"),
        // ISO instants (timeArrive).
        isoOk: parseClockTime("2026-07-21T08:04:31.000Z") !== null,
        // 12-hour clock.
        pm: hm("1:05:00 PM"),
        am12: hm("12:30 AM"),
        // Junk must be null, never an Invalid Date.
        empty: parseClockTime(""),
        nul: parseClockTime(null),
        junk: parseClockTime("not-a-time"),
        msIsNumber: typeof parseClockTimeMs("08:00") === "number",
        msNull: parseClockTimeMs(null),
      };
    });

    expect(results.t0800).toBe("8:0:0");
    expect(results.t0810).toBe("8:10:0");
    expect(results.t0920).toBe("9:20:0");
    expect(results.withSeconds).toBe("8:4:31");
    expect(results.isoOk).toBe(true);
    expect(results.pm).toBe("13:5:0");
    expect(results.am12).toBe("0:30:0");
    expect(results.empty).toBeNull();
    expect(results.nul).toBeNull();
    expect(results.junk).toBeNull();
    expect(results.msIsNumber).toBe(true);
    expect(results.msNull).toBeNull();
  });
});
