import { describe, it, expect } from "vitest";
import { getCategoryBibIssues, describeBibIssues, getUpcomingBibWarnings } from "../bibIssues";
import type { CategoryProps } from "@/types/types";

const cat = (id: number, name: string, over: Partial<CategoryProps> = {}) =>
  ({ id, raceUuid: "r", name, subCategory: null, laps: 5, lapsCounter: 0, riders: 0, startTime: null,
     isConnected: false, color: null, heat: 1, status: "upcoming", ...over }) as CategoryProps;
const rider = (bibNumber: number, category: string, over: Record<string, unknown> = {}) =>
  ({ raceUuid: "r", bibNumber, category, subCategory: null, status: "", ...over }) as any;

describe("bibIssues", () => {
  it("counts missing bibs and race-wide duplicates, ignoring DNS and other races", () => {
    const pro = cat(1, "Man Pro");
    const riders = [
      rider(0, "Man Pro"),
      rider(7, "Man Pro"),
      rider(7, "Juniors"),            // duplicate across categories still counts
      rider(9, "Man Pro"),
      rider(9, "Man Pro", { status: "DNS" }), // DNS never crosses — not a duplicate
      rider(0, "Man Pro", { raceUuid: "other" }),
    ];
    const issues = getCategoryBibIssues(pro, riders, "r");
    expect(issues).toEqual({ noBib: 1, dupBib: 1, dupBibs: [7] });
    expect(describeBibIssues(issues)).toEqual([
      "1 rider without a bib number",
      "1 rider with a duplicate bib number",
    ]);
  });

  it("warns only for categories that haven't started yet", () => {
    const cats = [cat(1, "Man Pro"), cat(2, "Juniors", { status: "running" }), cat(3, "Women", { status: undefined })];
    const riders = [rider(0, "Man Pro"), rider(0, "Juniors"), rider(0, "Women"), rider(5, "Women")];
    expect(getUpcomingBibWarnings(cats, riders, "r").map((w) => w.category.id)).toEqual([1, 3]);
  });

  it("no warnings when every bib is set and unique", () => {
    expect(getUpcomingBibWarnings([cat(1, "Man Pro")], [rider(1, "Man Pro"), rider(2, "Man Pro")], "r")).toEqual([]);
  });
});
