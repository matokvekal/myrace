import { describe, it, expect } from "vitest";
import { lapBreakdown, fmtDuration, fmtGapMs, fmtClock, startOf } from "../lapBreakdown";
import { makeRider } from "@/test/factories";
import type { RiderProps } from "@/types/types";

/** Synthetic riders only. Times are minutes:seconds after a 10:00:00 start. */
const START = new Date(2026, 9, 27, 10, 0, 0).getTime();
const at = (min: number, sec = 0) => START + (min * 60 + sec) * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

let nextId = 1;
const rider = (
  crossings: (number | null)[],
  over: Partial<RiderProps> & { recovered?: number[] } = {}
): RiderProps => {
  const { recovered = [], ...rest } = over;
  const details: RiderProps["lapsDetails"] = [];
  let prev: number = START;
  crossings.forEach((ms, i) => {
    if (ms == null) return; // missing passage: no entry for this lap
    details.push({
      lap: i + 1,
      startTime: new Date(prev),
      endTime: iso(ms) as unknown as Date,
      lapTime: "",
      ...(recovered.includes(i + 1) ? { recovered: true } : {}),
    } as RiderProps["lapsDetails"][number]);
    prev = ms;
  });
  const id = nextId++;
  return makeRider({
    id, bibNumber: id, category: "Elite", subCategory: null, totalLaps: 3, timeStartRace: "10:00:00",
    lapsCounter: crossings.length, lapsDetails: details, raceStatus: "running", status: "standing", ...rest,
  });
};

describe("lap durations", () => {
  it("lap 1 from the race start, then crossing to crossing", () => {
    const a = rider([at(10), at(21, 30), at(33)]);
    const b = lapBreakdown(a, [a]);
    expect(b.rows.map((r) => r.durationMs)).toEqual([600_000, 690_000, 690_000]);
    expect(b.rows.map((r) => fmtClock(r.crossingMs))).toEqual(["10:10:00", "10:21:30", "10:33:00"]);
    expect(b.totalMs).toBe(at(33) - START);
    expect(b.fastestLapMs).toBe(600_000);
    expect(b.fastestLap).toBe(1);
    expect(b.averageLapMs).toBe(660_000);
  });

  it("uses the start clock on the day of the first crossing when lap 1 has no recorded start", () => {
    const a = rider([at(10)]);
    a.lapsDetails[0].startTime = undefined as unknown as Date;
    expect(startOf(a)).toBe(START);
    expect(lapBreakdown(a, [a]).rows[0].durationMs).toBe(600_000);
  });

  it("no usable start: lap 1 and total are N/A, never guessed", () => {
    const a = rider([at(10), at(20)], { timeStartRace: null as unknown as string });
    a.lapsDetails[0].startTime = undefined as unknown as Date;
    const b = lapBreakdown(a, [a]);
    expect(b.rows[0].durationMs).toBeNull();
    expect(b.rows[1].durationMs).toBe(600_000);
    expect(b.totalMs).toBeNull();
    expect(b.averageLapMs).toBeNull();
  });
});

describe("intermediate rankings and leader gaps (same category, same lap)", () => {
  it("position and gap at each lap", () => {
    const a = rider([at(10), at(20), at(30)]);
    const b = rider([at(9, 50), at(20, 30), at(31)]);
    const ra = lapBreakdown(a, [a, b]);
    expect(ra.rows.map((r) => r.position)).toEqual([2, 1, 1]);
    expect(ra.rows.map((r) => r.gapMs)).toEqual([10_000, 0, 0]);
    const rb = lapBreakdown(b, [a, b]);
    expect(rb.rows.map((r) => r.position)).toEqual([1, 2, 2]);
    expect(rb.rows.map((r) => fmtGapMs(r.gapMs))).toEqual(["+00:00", "+00:30", "+01:00"]);
    expect(rb.position).toBe(2);
    expect(rb.finalGap).toEqual({ kind: "time", ms: 60_000 });
    expect(ra.finalGap).toEqual({ kind: "leader" });
  });

  it("riders of another category (same wave or Finish Group) are never compared", () => {
    const a = rider([at(10)]);
    const other = rider([at(5)], { category: "Juniors" });
    const b = lapBreakdown(a, [a, other]);
    expect(b.rows[0]).toMatchObject({ position: 1, gapMs: 0 });
    expect(b.position).toBe(1);
  });
});

describe("missing passages", () => {
  it("the rider's own missing lap is N/A, and so is the next lap's duration", () => {
    const c = rider([null, at(20), at(30)]);
    const b = lapBreakdown(c, [c]);
    expect(b.rows).toHaveLength(3);
    expect(b.rows[0]).toMatchObject({ crossingMs: null, durationMs: null, position: null, gapMs: null });
    expect(b.rows[1].durationMs).toBeNull();
    expect(b.rows[2].durationMs).toBe(600_000);
    expect(b.fastestLapMs).toBe(600_000);
  });

  it("another rider's missing passage makes that lap's positions and gaps N/A for everyone", () => {
    const a = rider([at(10), at(20)]);
    const c = rider([null, at(19)]); // lap 1 unknown, could have been ahead
    const b = lapBreakdown(a, [a, c]);
    expect(b.rows[0]).toMatchObject({ position: null, gapMs: null, crossingMs: at(10) });
    expect(b.rows[1]).toMatchObject({ position: 2, gapMs: 60_000 });
  });

  it("a rider with no passages has no rows and no position", () => {
    const a = rider([]);
    const b = lapBreakdown(a, [a]);
    expect(b.rows).toEqual([]);
    expect(b.position).toBeNull();
    expect(b.totalMs).toBeNull();
  });
});

describe("lapped and out riders", () => {
  it("a lapped rider is compared at the same completed lap; final gap is in laps", () => {
    const lead = rider([at(10), at(20), at(30)]);
    const second = rider([at(11), at(22), at(33)]);
    const lapped = rider([at(15)]);
    const b = lapBreakdown(lapped, [lead, second, lapped]);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]).toMatchObject({ position: 3, gapMs: 300_000 }); // vs the leader's lap 1, not lap 2
    expect(b.position).toBe(3);
    expect(b.finalGap).toEqual({ kind: "laps", laps: 2 });
  });

  it("DNF keeps its laps but has no final position or gap; DNS has nothing", () => {
    const a = rider([at(10), at(20)]);
    const dnf = rider([at(11)], { status: "DNF", raceStatus: "finished" });
    const dns = rider([], { status: "DNS" });
    const bd = lapBreakdown(dnf, [a, dnf, dns]);
    expect(bd.rows[0]).toMatchObject({ position: 2, gapMs: 60_000 });
    expect(bd.position).toBeNull();
    expect(bd.finalGap).toBeNull();
    expect(lapBreakdown(a, [a, dnf, dns]).position).toBe(1);
    expect(lapBreakdown(dns, [a, dnf, dns]).rows).toEqual([]);
  });

  it("a recovered passage is flagged and its laps never count as the fastest", () => {
    const a = rider([at(10), at(15), at(25)], { recovered: [2] });
    const b = lapBreakdown(a, [a]);
    expect(b.rows[1].recovered).toBe(true);
    expect(b.fastestLap).toBe(1); // laps 2 (5:00) and 3 are bounded by the estimated crossing
  });
});

describe("formatting", () => {
  it("durations as MM:SS or H:MM:SS, gaps as +MM:SS, N/A when unknown", () => {
    expect(fmtDuration(65_000)).toBe("01:05");
    expect(fmtDuration(3_725_000)).toBe("1:02:05");
    expect(fmtDuration(null)).toBe("N/A");
    expect(fmtGapMs(90_000)).toBe("+01:30");
    expect(fmtGapMs(null)).toBe("N/A");
    expect(fmtClock(null)).toBe("N/A");
  });
});
