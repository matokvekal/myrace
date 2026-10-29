import { describe, it, expect } from "vitest";
import {
  buildSchedule,
  riderInCategory,
  effectiveTotalLaps,
  withCategoryLaps,
  normalizeTime,
  toMinutes,
  minutesToTime,
  catWaveKey,
} from "../Schedule";
import { makeCategory } from "@/test/factories";

describe("riderInCategory (rider to category matching)", () => {
  it("matches on name and sub-category together", () => {
    const cat = { name: "Masters", subCategory: "19-29" };
    expect(riderInCategory({ category: "Masters", subCategory: "19-29" }, cat)).toBe(true);
    expect(riderInCategory({ category: "Masters", subCategory: "30-49" }, cat)).toBe(false);
    expect(riderInCategory({ category: "Elite", subCategory: "19-29" }, cat)).toBe(false);
  });

  it("treats null / undefined / missing sub-category as the same", () => {
    expect(riderInCategory({ category: "Elite" }, { name: "Elite", subCategory: null })).toBe(true);
    expect(riderInCategory({ category: "Elite", subCategory: null }, { name: "Elite" })).toBe(true);
  });
});

describe("time helpers", () => {
  it("normalizes times and keeps meaningful seconds", () => {
    expect(normalizeTime("9:05")).toBe("09:05");
    expect(normalizeTime("08:22:00")).toBe("08:22");
    expect(normalizeTime("08:22:30")).toBe("08:22:30");
    expect(normalizeTime("garbage")).toBeNull();
    expect(normalizeTime(null)).toBeNull();
  });

  it("converts to minutes and back", () => {
    expect(toMinutes("08:22:30")).toBe(502.5);
    expect(toMinutes(null)).toBe(Infinity);
    expect(minutesToTime(502)).toBe("08:22");
    expect(minutesToTime(1440 + 5)).toBe("00:05");
  });

  it("builds a composite category key", () => {
    expect(catWaveKey("Elite", "A")).toBe("Elite::A");
    expect(catWaveKey("Elite")).toBe("Elite::");
  });
});

describe("laps resolve through the category", () => {
  const cats = [makeCategory({ name: "Elite", laps: 5 }), makeCategory({ name: "Open", laps: null })];

  it("category laps win over the rider cache", () => {
    expect(effectiveTotalLaps({ category: "Elite", totalLaps: 0 }, cats)).toBe(5);
  });

  it("falls back to the rider laps when the category has none", () => {
    expect(effectiveTotalLaps({ category: "Open", totalLaps: 4 }, cats)).toBe(4);
    expect(effectiveTotalLaps({ category: "Unknown", totalLaps: 0 }, cats)).toBe(0);
  });

  it("withCategoryLaps only clones riders that change", () => {
    const same = { category: "Elite", totalLaps: 5 };
    const diff = { category: "Elite", totalLaps: 0 };
    const [a, b] = withCategoryLaps([same, diff], cats);
    expect(a).toBe(same);
    expect(b.totalLaps).toBe(5);
  });
});

describe("buildSchedule (waves)", () => {
  it("derives waves from start-time gaps when none are assigned", () => {
    const cats = [
      makeCategory({ name: "A", heat: null, startTime: "09:00" }),
      makeCategory({ name: "B", heat: null, startTime: "09:10" }),
      makeCategory({ name: "C", heat: null, startTime: "11:00" }),
    ];
    const s = buildSchedule(cats, 30);
    expect([...s.keys()]).toEqual([1, 2]);
    expect([...s.get(1)!.keys()]).toEqual(["09:00", "09:10"]);
  });

  it("uses explicit wave numbers as authoritative", () => {
    const cats = [
      makeCategory({ name: "A", heat: 2, startTime: "09:00" }),
      makeCategory({ name: "B", heat: 1, startTime: "09:05" }),
    ];
    const s = buildSchedule(cats, 30);
    expect([...s.keys()]).toEqual([1, 2]);
    expect(s.get(1)!.get("09:05")![0].name).toBe("B");
  });

  it("groups categories sharing a start time into one slot", () => {
    const cats = [
      makeCategory({ name: "A", heat: 1, startTime: "09:00" }),
      makeCategory({ name: "B", heat: 1, startTime: "09:00" }),
    ];
    const slot = buildSchedule(cats).get(1)!.get("09:00")!;
    expect(slot.map((c) => c.name)).toEqual(["A", "B"]);
  });

  it("appends categories with a start time but no wave after the last wave", () => {
    const cats = [
      makeCategory({ name: "A", heat: 1, startTime: "09:00" }),
      makeCategory({ name: "Late", heat: null, startTime: "13:00" }),
    ];
    expect([...buildSchedule(cats).keys()]).toEqual([1, 2]);
  });

  it("returns an empty schedule for no categories", () => {
    expect(buildSchedule([]).size).toBe(0);
  });

  it("buckets a category with no start time under TBD", () => {
    const s = buildSchedule([makeCategory({ heat: 1, startTime: null })]);
    expect([...s.get(1)!.keys()]).toEqual(["TBD"]);
  });
});
