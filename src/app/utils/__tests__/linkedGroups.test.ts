import { describe, it, expect } from "vitest";
import { computeGroupSignals, categoryGroupKey, riderGroupKey, isLeaderFinishAll } from "../linkedGroups";
import type { CategoryProps } from "@/types/types";

const cat = (name: string, over: Partial<CategoryProps> = {}) =>
  ({ id: 1, raceUuid: "r", name, subCategory: null, laps: 5, lapsCounter: 0, riders: 0, startTime: null,
     isConnected: false, color: null, heat: 1, ...over }) as CategoryProps;
const rider = (category: string, lapsCounter: number, over: Record<string, unknown> = {}) =>
  ({ category, subCategory: null, totalLaps: 5, lapsCounter, raceStatus: "running", status: "", ...over }) as any;

describe("linkedGroups", () => {
  it("never groups by name or by wave: Masters without linkGroup are independent", () => {
    expect(categoryGroupKey(cat("Man Masters 30-39"))).not.toBe(categoryGroupKey(cat("Women Masters 30-39")));
    expect(categoryGroupKey(cat("Man Pro"))).not.toBe(categoryGroupKey(cat("Man Elite")));
  });

  it("no category-wide bell at 2 laps remaining (individual bell only)", () => {
    const s = computeGroupSignals([cat("Man Pro")], [rider("Man Pro", 3), rider("Man Pro", 0)]);
    expect(s.bell.size).toBe(0);
  });

  it("category-wide bell at exactly 1 lap remaining, scoped to that category", () => {
    const cats = [cat("Man Pro"), cat("Man Elite")];
    const s = computeGroupSignals(cats, [rider("Man Pro", 4), rider("Man Pro", 1), rider("Man Elite", 1)]);
    expect([...s.bell]).toEqual([riderGroupKey(cats[0], { totalLaps: 5 })]);
    expect(s.finish.size).toBe(0);
  });

  it("finish only after ALL laps are completed", () => {
    const cats = [cat("Man Pro")];
    // finished flag but short of laps (manual / group-flag finish) must not trigger
    expect(computeGroupSignals(cats, [rider("Man Pro", 2, { raceStatus: "finished" })]).finish.size).toBe(0);
    // 6th of 7 style: 1 to go -> bell only
    const one = computeGroupSignals(cats, [rider("Man Pro", 4)]);
    expect(one.finish.size).toBe(0);
    expect(one.bell.size).toBe(1);
    // all laps and finished -> finish
    expect(computeGroupSignals(cats, [rider("Man Pro", 5, { raceStatus: "finished" })]).finish.size).toBe(1);
  });

  it("explicit linkGroup shares bell and finish across categories", () => {
    const a = cat("Man Masters 30-39", { linkGroup: "Masters" });
    const b = cat("Women Masters 40-49", { linkGroup: " masters " });
    const c = cat("Man Pro");
    const s = computeGroupSignals([a, b, c], [rider("Man Masters 30-39", 4), rider("Man Pro", 1)]);
    expect(s.bell.has(riderGroupKey(b, { totalLaps: 5 }))).toBe(true);
    expect(s.bell.has(riderGroupKey(c, { totalLaps: 5 }))).toBe(false);
  });

  it("a Finish Group mixing distances: the shorter race's finish never finishes the longer race", () => {
    // Men Level 2 (6 laps) and Women Level 2 (2 laps) share Finish Group 1.
    const men = cat("Men Level 2", { linkGroup: "1", laps: 6 });
    const women = cat("Women Level 2", { linkGroup: "1", laps: 2 });
    const riders = [
      rider("Women Level 2", 2, { totalLaps: 2, raceStatus: "finished" }),
      rider("Men Level 2", 2, { totalLaps: 6 }), // 4 laps left
    ];
    const s = computeGroupSignals([men, women], riders);
    expect(s.finish.has(riderGroupKey(women, { totalLaps: 2 }))).toBe(true);
    expect(s.finish.has(riderGroupKey(men, { totalLaps: 6 }))).toBe(false);
    // …and a 1-lap-to-go women's leader rings no bell for the men either.
    const bell = computeGroupSignals([men, women], [rider("Women Level 2", 1, { totalLaps: 2 })]);
    expect(bell.bell.has(riderGroupKey(men, { totalLaps: 6 }))).toBe(false);
  });

  it("same Finish Group, same distance: the shared finish still applies", () => {
    const a = cat("Men Level 2", { linkGroup: "1", laps: 4 });
    const b = cat("Juniors", { linkGroup: "1", laps: 4 });
    const s = computeGroupSignals([a, b], [rider("Men Level 2", 4, { totalLaps: 4, raceStatus: "finished" })]);
    expect(s.finish.has(riderGroupKey(b, { totalLaps: 4 }))).toBe(true);
  });

  it("ignores DNF riders as a trigger", () => {
    const s = computeGroupSignals([cat("Man Pro")], [rider("Man Pro", 5, { raceStatus: "finished", status: "DNF" })]);
    expect(s.finish.size).toBe(0);
  });
});

describe("first finish – all finish (race.leaderFinishAll)", () => {
  it("is on by default: undefined and true both count as on, only false turns it off", () => {
    expect(isLeaderFinishAll(undefined)).toBe(true);
    expect(isLeaderFinishAll({})).toBe(true);
    expect(isLeaderFinishAll({ leaderFinishAll: true })).toBe(true);
    expect(isLeaderFinishAll({ leaderFinishAll: false })).toBe(false);
  });

  it("off: no category-wide bell or finish, whatever the leader did", () => {
    const cats = [cat("Man Pro")];
    const riders = [rider("Man Pro", 5, { raceStatus: "finished" }), rider("Man Pro", 4), rider("Man Pro", 2)];
    expect(computeGroupSignals(cats, riders).finish.size).toBe(1);
    const off = computeGroupSignals(cats, riders, false);
    expect(off.bell.size).toBe(0);
    expect(off.finish.size).toBe(0);
  });
});
