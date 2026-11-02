import { describe, expect, it } from "vitest";
import { daysSinceRace, waveProblem } from "../waveHealth";

const base = { state: "upcoming" as const, start: 600, now: 480, daysSinceRace: 0, hasBibIssue: false, missing: 0 };

describe("waveProblem", () => {
  it("is fine when everyone is checked in and it isn't due yet, or it has finished", () => {
    expect(waveProblem(base)).toBeNull();
    expect(waveProblem({ ...base, state: "finished", now: 900, daysSinceRace: 3 })).toBeNull();
    expect(waveProblem({ ...base, state: "running", now: 610 })).toBeNull();
  });

  it("flags a wave whose start time has passed", () => {
    expect(waveProblem({ ...base, now: 601 })).toBe("Not started");
  });

  it("flags a wave left open after race day", () => {
    expect(waveProblem({ ...base, daysSinceRace: 1 })).toBe("Not started");
    expect(waveProblem({ ...base, state: "running", daysSinceRace: 1 })).toBe("Not finished");
  });

  it("flags bib problems and an unfinished Check-In", () => {
    expect(waveProblem({ ...base, hasBibIssue: true })).toBe("Bib problem");
    expect(waveProblem({ ...base, missing: 2 })).toBe("Check-In");
  });

  it("doesn't judge a future race by today's clock", () => {
    expect(waveProblem({ ...base, now: 900, daysSinceRace: -2 })).toBeNull();
  });
});

describe("daysSinceRace", () => {
  const today = new Date(2026, 10, 2, 15, 0);
  it.each([
    ["2026-11-02", 0],
    ["2026-11-01", 1],
    ["2026-11-05", -3],
    ["02/11/2026", 0],
    ["not a date", 0],
    [undefined, 0],
  ])("%s → %i", (date, days) => {
    expect(daysSinceRace(date, today)).toBe(days);
  });
});
