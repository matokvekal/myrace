import { describe, it, expect } from "vitest";
import { computeGroupPhases, categoryGroupKey, isLeaderFinishAll, phaseOfRider } from "../linkedGroups";
import type { CategoryProps, RiderProps } from "@/types/types";

/** Synthetic riders; crossings in minutes after 10:00. */
const T0 = Date.parse("2026-06-01T10:00:00Z");
const cat = (name: string, over: Partial<CategoryProps> = {}) =>
  ({ id: 1, raceUuid: "r", name, subCategory: null, laps: 5, lapsCounter: 0, riders: 0, startTime: null,
     isConnected: false, color: null, heat: 1, ...over }) as CategoryProps;
const rider = (category: string, crossingsMin: number[], over: Partial<RiderProps> = {}) =>
  ({ category, subCategory: null, totalLaps: 5, lapsCounter: crossingsMin.length, raceStatus: "running", status: "standing",
     lapsDetails: crossingsMin.map((m, i) => ({ lap: i + 1, endTime: new Date(T0 + m * 60_000).toISOString() })), ...over }) as unknown as RiderProps;
const view = (r: RiderProps, cats: CategoryProps[], riders: RiderProps[], enabled = true) => {
  const p = phaseOfRider(r, cats, computeGroupPhases(cats, riders, enabled));
  return `${p.icon}:${p.remaining}`;
};

describe("linkedGroups", () => {
  it("never groups by name or by wave: Masters without linkGroup are independent", () => {
    expect(categoryGroupKey(cat("Man Masters 30-39"))).not.toBe(categoryGroupKey(cat("Women Masters 30-39")));
    expect(categoryGroupKey(cat("Man Pro"))).not.toBe(categoryGroupKey(cat("Man Elite")));
  });

  it("the group bell (first rider got the bell) reaches only that category without a Finish Group", () => {
    const cats = [cat("Man Pro"), cat("Man Elite")];
    const leader = rider("Man Pro", [10, 20, 30, 40]);
    const back = rider("Man Pro", [12]);
    const other = rider("Man Elite", [11]);
    const all = [leader, back, other];
    expect(view(leader, cats, all)).toBe("flag:1");
    expect(view(back, cats, all)).toBe("bell:2");
    expect(view(other, cats, all)).toBe("none:4");
  });

  it("category laps win over a rider's stale own lap count", () => {
    const cats = [cat("Man Pro", { laps: 3 })];
    const r = rider("Man Pro", [10], { totalLaps: 5 });
    expect(view(r, cats, [r])).toBe("bell:2");
  });

  it("an explicit Finish Group shares the phases across categories and waves", () => {
    const men = cat("Men Level 2", { linkGroup: "1", laps: 6, heat: 1 });
    const women = cat("Women Level 2", { linkGroup: " 1 ", laps: 2, heat: 3 });
    expect(categoryGroupKey(men)).toBe(categoryGroupKey(women));
    const w = rider("Women Level 2", [10, 20], { totalLaps: 2, raceStatus: "finished" });
    const m = rider("Men Level 2", [11], { totalLaps: 6 });
    expect(view(m, [men, women], [w, m])).toBe("flag:0");
  });

  it("DNF riders never trigger anything", () => {
    const cats = [cat("Man Pro")];
    const dnf = rider("Man Pro", [10, 20, 30, 40, 50], { raceStatus: "finished", status: "DNF" });
    const r = rider("Man Pro", [12]);
    expect(view(r, cats, [dnf, r])).toBe("none:4");
  });
});

describe("first finish – all finish (race.leaderFinishAll)", () => {
  it("is on by default: undefined and true both count as on, only false turns it off", () => {
    expect(isLeaderFinishAll(undefined)).toBe(true);
    expect(isLeaderFinishAll({})).toBe(true);
    expect(isLeaderFinishAll({ leaderFinishAll: true })).toBe(true);
    expect(isLeaderFinishAll({ leaderFinishAll: false })).toBe(false);
  });

  it("off: no group bell or finish, whatever the leader did", () => {
    const cats = [cat("Man Pro")];
    const leader = rider("Man Pro", [10, 20, 30, 40, 50], { raceStatus: "finished" });
    const r = rider("Man Pro", [12]);
    expect(view(r, cats, [leader, r])).toBe("flag:0");
    expect(view(r, cats, [leader, r], false)).toBe("none:4");
  });
});
