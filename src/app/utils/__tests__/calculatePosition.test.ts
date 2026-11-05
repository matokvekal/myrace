import { describe, it, expect } from "vitest";
import calculatePositions from "../calculatePosition";
import { makeRider } from "@/test/factories";

const at = (hhmmss: string) => `2026-01-01T${hhmmss}.000Z`;

describe("calculatePositions (standings)", () => {
  it("ranks by laps first, then by earlier arrival", () => {
    const a = makeRider({ lapsCounter: 3, timeArrive: at("10:05:00") });
    const b = makeRider({ lapsCounter: 3, timeArrive: at("10:04:00") });
    const c = makeRider({ lapsCounter: 4, timeArrive: at("10:09:00") });
    const out = calculatePositions([a, b, c]);
    expect(out.map((r) => r.id)).toEqual([c.id, b.id, a.id]);
    expect(out.map((r) => r.position_race)).toEqual([1, 2, 3]);
  });

  it("ranks each category separately (position_category)", () => {
    const e1 = makeRider({ category: "Elite", lapsCounter: 2, timeArrive: at("10:00:00") });
    const e2 = makeRider({ category: "Elite", lapsCounter: 2, timeArrive: at("10:01:00") });
    const m1 = makeRider({ category: "Masters", lapsCounter: 2, timeArrive: at("10:02:00") });
    const out = calculatePositions([e1, e2, m1]);
    const byId = Object.fromEntries(out.map((r) => [r.id, r]));
    expect(byId[e1.id].position_category).toBe(1);
    expect(byId[e2.id].position_category).toBe(2);
    expect(byId[m1.id].position_category).toBe(1);
    expect(byId[m1.id].position_race).toBe(3);
  });

  it("keeps the same category name in different sub-categories apart", () => {
    const a = makeRider({ category: "Masters", subCategory: "19-29", lapsCounter: 1, timeArrive: at("10:00:00") });
    const b = makeRider({ category: "Masters", subCategory: "30-49", lapsCounter: 1, timeArrive: at("10:01:00") });
    const out = calculatePositions([a, b]);
    expect(out.every((r) => r.position_category === 1)).toBe(true);
  });

  it("excludes DNF / DNS / DSQ riders from the ranking", () => {
    const ok = makeRider({ lapsCounter: 1, timeArrive: at("10:00:00") });
    const out = calculatePositions([
      ok,
      makeRider({ status: "DNF", lapsCounter: 5 }),
      makeRider({ status: "DNS" }),
      makeRider({ status: "DSQ", lapsCounter: 9 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(ok.id);
  });

  it("places a rider with no arrival time BEHIND those who crossed on equal laps", () => {
    const crossed = makeRider({ lapsCounter: 5, timeArrive: at("14:33:00") });
    const stranded = makeRider({ lapsCounter: 5, timeArrive: null });
    const out = calculatePositions([stranded, crossed]);
    expect(out[0].id).toBe(crossed.id);
  });

  it("is pure: never mutates the input riders or array", () => {
    const riders = [
      makeRider({ lapsCounter: 2, timeArrive: at("10:00:00") }),
      makeRider({ lapsCounter: 3, timeArrive: at("10:01:00") }),
    ];
    const snapshot = JSON.stringify(riders);
    const ids = riders.map((r) => r.id);
    calculatePositions(riders);
    expect(JSON.stringify(riders)).toBe(snapshot);
    expect(riders.map((r) => r.id)).toEqual(ids);
  });

  it("handles an empty field", () => {
    expect(calculatePositions([])).toEqual([]);
  });
});
