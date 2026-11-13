/**
 * Race time from absolute instants (P0: every time showed "—" in Results once the
 * page was viewed on another day / in another timezone than the starter's).
 */
import { describe, expect, it } from "vitest";
import { riderElapsedMs, riderTotalTime } from "../timeUtils";

const START = "2026-11-08T07:00:00.000Z";
const ARRIVE = "2026-11-08T08:12:34.000Z";

describe("riderElapsedMs", () => {
  it("uses lap 1's absolute start → timeArrive, ignoring the HH:MM:SS start clock", () => {
    const r = {
      // a clock string from another timezone, and "today" is not race day
      timeStartRace: "23:59:00",
      timeArrive: ARRIVE,
      elapsedTimeFromStart: null,
      lapsDetails: [{ startTime: START }, { startTime: "2026-11-08T07:40:00.000Z" }],
    };
    expect(riderElapsedMs(r)).toBe((72 * 60 + 34) * 1000);
    expect(riderTotalTime(r)).toBe("01:12:34");
  });

  it("accepts a Date object as lap start (local races keep Dates in IndexedDB)", () => {
    const r = { timeStartRace: null, timeArrive: ARRIVE, elapsedTimeFromStart: null, lapsDetails: [{ startTime: new Date(START) }] };
    expect(riderElapsedMs(r)).toBe((72 * 60 + 34) * 1000);
  });

  it("falls back to the server-computed elapsedTimeFromStart", () => {
    expect(riderElapsedMs({ timeStartRace: null, timeArrive: ARRIVE, elapsedTimeFromStart: "01:12:34", lapsDetails: [] })).toBe(4354000);
    expect(riderElapsedMs({ timeStartRace: null, timeArrive: ARRIVE, elapsedTimeFromStart: "42:05" })).toBe((42 * 60 + 5) * 1000);
  });

  it("last resort: the start clock anchored to the arrival's day, not today", () => {
    const arrive = new Date(2025, 0, 3, 10, 30, 0); // a past day, local time
    const r = { timeStartRace: "09:00:00", timeArrive: arrive.toISOString(), elapsedTimeFromStart: null };
    expect(riderElapsedMs(r)).toBe(90 * 60 * 1000);
  });

  it("null without an arrival or any usable time", () => {
    expect(riderElapsedMs({ timeStartRace: "09:00:00", timeArrive: null, elapsedTimeFromStart: null })).toBeNull();
    expect(riderTotalTime({ timeStartRace: null, timeArrive: null, elapsedTimeFromStart: "00:00" })).toBe("—");
  });
});
