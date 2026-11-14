import { describe, expect, it } from "vitest";
import {
  bibCorrectionsFrom,
  findBibConflicts,
  initialBibChoices,
  proposeFreeBib,
  validateBibChoices,
  type ImportBibRow,
} from "../bibConflicts";

const row = (index: number, bib: number, heat = 1, name = `R${index}`): ImportBibRow => ({ index, row: index + 2, bib, name, heat, category: "Open" });

describe("proposeFreeBib", () => {
  it("prefixes thousands: 21 → 1021, 189 → 1189", () => {
    expect(proposeFreeBib(21, new Set([21]))).toBe(1021);
    expect(proposeFreeBib(189, new Set([189]))).toBe(1189);
  });
  it("skips occupied candidates: 1189 taken → 2189, then 3189", () => {
    const used = new Set([189, 1189]);
    expect(proposeFreeBib(189, used)).toBe(2189);
    expect(proposeFreeBib(189, used)).toBe(3189);
  });
  it("4+ digit bibs step by the next power of ten", () => {
    expect(proposeFreeBib(1021, new Set([1021]))).toBe(11021);
  });
  it("never exceeds the max bib", () => {
    const n = proposeFreeBib(999999, new Set([999999]));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(999999);
  });
});

describe("findBibConflicts", () => {
  it("no conflicts → empty", () => {
    expect(findBibConflicts([row(0, 1), row(1, 2)], [])).toEqual([]);
  });

  it("duplicate within the file across different waves: first row keeps, the other gets 1000+bib", () => {
    const groups = findBibConflicts([row(0, 21, 1), row(1, 21, 3)], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("file");
    expect(groups[0].rows.map((r) => [r.index, r.proposed, r.keepsOriginal])).toEqual([[0, 21, true], [1, 1021, false]]);
  });

  it("existing rider keeps the bib; every imported row with it gets a proposal", () => {
    const groups = findBibConflicts([row(0, 21), row(1, 21)], [{ bib: 21, name: "Cohen Dan" }]);
    expect(groups[0].kind).toBe("existing");
    expect(groups[0].rows.map((r) => r.proposed)).toEqual([1021, 2021]);
    expect(groups[0].rows.every((r) => !r.keepsOriginal)).toBe(true);
    expect(groups[0].rows[0].reason).toContain("Cohen Dan");
  });

  it("multiple duplicates of the same bib get distinct numbers", () => {
    const groups = findBibConflicts([row(0, 5), row(1, 5), row(2, 5), row(3, 5)], []);
    const nums = groups[0].rows.map((r) => r.proposed);
    expect(nums).toEqual([5, 1005, 2005, 3005]);
  });

  it("proposals avoid existing bibs, other file bibs and earlier proposals", () => {
    // 1189 is in the file, 2189 belongs to an existing rider → 3189.
    const groups = findBibConflicts([row(0, 189), row(1, 189), row(2, 1189)], [{ bib: 2189, name: "X" }]);
    const g = groups.find((x) => x.bib === 189)!;
    expect(g.rows[1].proposed).toBe(3189);
  });

  it("ignores rows without a bib", () => {
    expect(findBibConflicts([row(0, 0), row(1, 0)], [])).toEqual([]);
  });
});

describe("validateBibChoices", () => {
  const rows = [row(0, 21), row(1, 21), row(2, 1021)];

  it("accepts the proposals", () => {
    const groups = findBibConflicts(rows, []);
    expect(validateBibChoices(rows, [], initialBibChoices(groups)).size).toBe(0);
  });

  it("flags a manual number that collides with another row of the file", () => {
    const errors = validateBibChoices(rows, [], new Map([[0, 21], [1, 1021]]));
    expect(errors.get(1)).toMatch(/also used on row/);
  });

  it("flags a manual number that belongs to an existing rider", () => {
    const errors = validateBibChoices(rows, [{ bib: 77, name: "Levi" }], new Map([[0, 21], [1, 77]]));
    expect(errors.get(1)).toContain("Levi");
  });

  it("flags empty / non-positive / too-large numbers", () => {
    expect(validateBibChoices(rows, [], new Map([[0, 21], [1, null]])).get(1)).toMatch(/whole number/);
    expect(validateBibChoices(rows, [], new Map([[0, 21], [1, 1000000]])).get(1)).toMatch(/at most/);
  });

  it("leaving both rows on the original is still a duplicate", () => {
    const errors = validateBibChoices(rows, [], new Map([[0, 21], [1, 21]]));
    expect(errors.size).toBe(2);
  });
});

describe("bibCorrectionsFrom", () => {
  it("lists only changed numbers, with original, corrected and reason", () => {
    const groups = findBibConflicts([row(0, 21), row(1, 21)], []);
    const out = bibCorrectionsFrom(groups, new Map([[0, 21], [1, 4021]]));
    expect(out).toEqual([{ index: 1, originalBib: 21, correctedBib: 4021, reason: expect.stringContaining("Duplicate bib at import") }]);
  });
  it("the organizer may move the keeper instead", () => {
    const groups = findBibConflicts([row(0, 21), row(1, 21)], []);
    const out = bibCorrectionsFrom(groups, new Map([[0, 1021], [1, 21]]));
    expect(out.map((c) => [c.index, c.correctedBib])).toEqual([[0, 1021]]);
  });
});
