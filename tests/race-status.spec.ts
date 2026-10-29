import { test, expect } from "@playwright/test";

/**
 * `race.status` only ever moves upcoming -> running (StartManager starts a
 * wave) — nothing ever flips a race to "finished" at the race level. A race
 * whose event date has passed but was never started used to show "Soon"
 * forever on the race list/tile. `effectiveRaceStatus` overrides that display
 * only: a still-"upcoming" race past its date reads as finished; a running
 * race is left alone regardless of date.
 *
 * Exercised in the browser so it runs against the real shipped module.
 */
test.describe("effectiveRaceStatus", () => {
  test("treats a past-dated upcoming race as finished, leaves others alone", async ({ page }) => {
    await page.goto("/main");

    const results = await page.evaluate(async () => {
      const mod = await import("/src/app/utils/raceStatus.ts");
      const { effectiveRaceStatus } = mod as {
        effectiveRaceStatus: (status: string | undefined, date?: string) => string;
      };

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = yesterday.toISOString().split("T")[0];

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tStr = tomorrow.toISOString().split("T")[0];

      return {
        pastUpcoming: effectiveRaceStatus("upcoming", yStr),
        futureUpcoming: effectiveRaceStatus("upcoming", tStr),
        noDateUpcoming: effectiveRaceStatus("upcoming", undefined),
        pastRunning: effectiveRaceStatus("running", yStr),
        pastFinished: effectiveRaceStatus("finished", yStr),
        undefinedStatus: effectiveRaceStatus(undefined, yStr),
        junkDate: effectiveRaceStatus("upcoming", "not-a-date"),
      };
    });

    expect(results.pastUpcoming).toBe("finished");
    expect(results.futureUpcoming).toBe("upcoming");
    expect(results.noDateUpcoming).toBe("upcoming");
    // Actually running/finished races are never overridden by date.
    expect(results.pastRunning).toBe("running");
    expect(results.pastFinished).toBe("finished");
    // Missing status defaults to "upcoming" before the date check applies.
    expect(results.undefinedStatus).toBe("finished");
    // An unparseable date must not crash the badge — falls back to the raw status.
    expect(results.junkDate).toBe("upcoming");
  });
});
