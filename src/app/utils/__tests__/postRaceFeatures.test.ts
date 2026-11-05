import { describe, it, expect } from "vitest";
import { getCategoryLocks } from "../categoryLocks";
import { matchesRiderSearch, groupRidersByWaveAndCategory } from "../riderList";
import { buildCategoryResults } from "../boardResults";
import { makeCategory, makeRider } from "@/test/factories";

describe("getCategoryLocks", () => {
  it("opens everything for an upcoming category", () => {
    const l = getCategoryLocks(makeCategory({ status: "upcoming" }), []);
    expect(l).toMatchObject({ color: false, wave: false, startTime: false, laps: false, reason: null });
  });

  it("locks wave and start time once started, but keeps colour and laps editable", () => {
    const l = getCategoryLocks(makeCategory({ status: "running" }), []);
    expect(l).toMatchObject({ color: false, wave: true, startTime: true, laps: false });
    expect(l.reason).toMatch(/started/i);
  });

  it("locks everything, colour included, once finished", () => {
    const l = getCategoryLocks(makeCategory({ status: "finished" }), []);
    expect(l).toMatchObject({ color: true, wave: true, startTime: true, laps: true });
    expect(l.reason).toMatch(/finished/i);
  });

  it("never lets laps drop below what riders already completed in THAT category", () => {
    const cat = makeCategory({ name: "Pro", status: "running" });
    const l = getCategoryLocks(cat, [
      makeRider({ category: "Pro", lapsCounter: 4 }),
      makeRider({ category: "Pro", lapsCounter: 2 }),
      makeRider({ category: "Other", lapsCounter: 9 }),
    ]);
    expect(l.minLaps).toBe(4);
  });
});

describe("rider search", () => {
  const r = makeRider({ firstName: "Dana", lastName: "Levi", bibNumber: 142 });
  it("matches first, last, full name (either order) and bib, case-insensitively and partially", () => {
    for (const q of ["dan", "LEV", "dana levi", "levi dana", "142", "14", "a l"]) {
      expect(matchesRiderSearch(r, q), q).toBe(true);
    }
  });
  it("does not match unrelated text and matches everyone on an empty query", () => {
    expect(matchesRiderSearch(r, "zzz")).toBe(false);
    expect(matchesRiderSearch(r, "999")).toBe(false);
    expect(matchesRiderSearch(r, "   ")).toBe(true);
  });
  it("handles Hebrew names", () => {
    expect(matchesRiderSearch(makeRider({ firstName: "דנה", lastName: "לוי" }), "לו")).toBe(true);
  });
});

describe("Wave → Category → Riders grouping", () => {
  const c1 = makeCategory({ name: "Elite", heat: 1, startTime: "09:00" });
  const c2 = makeCategory({ name: "Juniors", heat: 2, startTime: "10:30" });
  const c3 = makeCategory({ name: "Masters", heat: 1, startTime: "09:10" });
  const cats = [c2, c3, c1];
  const riders = [
    makeRider({ category: "Juniors", bibNumber: 5 }),
    makeRider({ category: "Elite", bibNumber: 2 }),
    makeRider({ category: "Masters", bibNumber: 3 }),
    makeRider({ category: "Elite", bibNumber: 1 }),
    makeRider({ category: "Ghost", bibNumber: 9 }),
  ];

  it("orders waves ascending, categories by schedule, keeps caller's rider order, unassigned last", () => {
    const g = groupRidersByWaveAndCategory(riders, cats);
    expect(g.map((w) => w.wave)).toEqual([1, 2, null]);
    expect(g[0].categories.map((c) => c.name)).toEqual(["Elite", "Masters"]);
    expect(g[0].categories[0].riders.map((x) => x.bibNumber)).toEqual([2, 1]);
    expect(g[0].count).toBe(3);
    expect(g[2].categories[0].name).toBe("Ghost");
  });
});

describe("Board expanded results", () => {
  it("ranks runners/finishers, then lists DNF/DSQ/DNS and not-started riders WITHOUT a position", () => {
    const riders = [
      makeRider({ bibNumber: 1, raceStatus: "finished", lapsCounter: 3, position_category: 1 }),
      makeRider({ bibNumber: 2, raceStatus: "running", lapsCounter: 2, position_category: 2 }),
      makeRider({ bibNumber: 3, raceStatus: "finished", status: "DNF", lapsCounter: 3, position_category: 1 }),
      makeRider({ bibNumber: 4, raceStatus: "upcoming" }),
      makeRider({ bibNumber: 5, raceStatus: "finished", status: "DNS" }),
    ];
    const rows = buildCategoryResults(riders);
    expect(rows.map((r) => [r.rider.bibNumber, r.position, r.label])).toEqual([
      [1, 1, null],
      [2, 2, null],
      [3, null, "DNF"],
      [5, null, "DNS"],
      [4, null, "Not started"],
    ]);
  });
});
