import { describe, it, expect } from "vitest";
import { DEFAULT_MIN_LAP_SECONDS, formatMinLap, minLapMsFor } from "../minLap";

describe("minimum lap interval", () => {
  it("existing races (unset) keep 60 s; new races default to 3 min; a race's own value wins", () => {
    expect(minLapMsFor(undefined)).toBe(60_000);
    expect(minLapMsFor({ minLapSeconds: null })).toBe(60_000);
    expect(DEFAULT_MIN_LAP_SECONDS).toBe(180);
    expect(minLapMsFor({ minLapSeconds: 240 })).toBe(240_000);
  });
  it("formats choices", () => {
    expect([formatMinLap(30), formatMinLap(180), formatMinLap(90)]).toEqual(["30 s", "3 min", "1 min 30 s"]);
  });
});
