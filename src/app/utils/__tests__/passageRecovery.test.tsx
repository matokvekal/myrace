import { describe, it, expect } from "vitest";
import { checkRecovery, withRecoveredPassage, hhmm } from "../passageRecovery";
import { makeRider } from "@/test/factories";

/** RECAP and missed-passage recovery (times on today's date). */
const at = (hm: string) => { const [h, m] = hm.split(":").map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const MIN3 = 180_000;
const rider = () =>
  makeRider({
    id: 1, bibNumber: 42, raceStatus: "running", status: "standing", timeStartRace: "00:00:00", totalLaps: 5, lapsCounter: 2,
    lapsDetails: [
      { lap: 1, startTime: at("00:00"), endTime: at("00:10"), lapTime: "10:00" },
      { lap: 2, startTime: at("00:10"), endTime: at("00:30"), lapTime: "20:00" },
    ],
  });
const NOW = at("23:59");

describe("checkRecovery", () => {
  it("a genuinely missing passage: ok, and which lap it becomes", () => {
    expect(checkRecovery(rider(), at("00:20"), MIN3, NOW)).toEqual({ kind: "ok", becomesLap: 2 });
  });
  it("an existing passage within the minimum: shown as possibly the same crossing (never added silently)", () => {
    const r = checkRecovery(rider(), at("00:31"), MIN3, NOW);
    expect(r.kind).toBe("near");
    if (r.kind === "near") expect(hhmm(r.nearest)).toBe(hhmm(at("00:30")));
  });
  it("refuses before the start, in the future, or once all laps are done", () => {
    expect(checkRecovery({ ...rider(), timeStartRace: null }, at("00:20"), MIN3, NOW).kind).toBe("invalid");
    expect(checkRecovery(rider(), new Date(NOW.getTime() + 60_000), MIN3, NOW).kind).toBe("invalid");
    expect(checkRecovery({ ...rider(), lapsCounter: 5 }, at("00:20"), MIN3, NOW).kind).toBe("invalid");
  });
});

describe("withRecoveredPassage", () => {
  it("inserts at the estimated time, renumbers laps, keeps the other passages, marks it recovered", () => {
    const out = withRecoveredPassage(rider(), at("00:20"), at("00:40"));
    expect(out.lapsCounter).toBe(3);
    expect(out.lapsDetails.map((l) => [l.lap, hhmm(l.endTime), l.lapTime, !!(l as { recovered?: boolean }).recovered])).toEqual([
      [1, hhmm(at("00:10")), "10:00", false],
      [2, hhmm(at("00:20")), "10:00", true],
      [3, hhmm(at("00:30")), "10:00", false],
    ]);
    expect(out.timeArrive).toBe(at("00:30").toISOString());
  });
});
