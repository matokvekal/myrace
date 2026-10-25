import { describe, it, expect } from "vitest";
import { computeGroupSignals, categoryGroupKey, isLeaderFinishAll } from "../linkedGroups";
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
    expect([...s.bell]).toEqual([categoryGroupKey(cats[0])]);
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
    expect(s.bell.has(categoryGroupKey(b))).toBe(true);
    expect(s.bell.has(categoryGroupKey(c))).toBe(false);
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
