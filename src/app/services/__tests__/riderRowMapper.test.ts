import { describe, it, expect } from "vitest";
import { buildHeatNameMap, filterImportRows, importSkipReason, rowToRider } from "../riderRowMapper";
import type { ColumnMapping } from "@/types/csv.types";

const map = (cols: [string, ColumnMapping["targetField"]][]): ColumnMapping[] =>
  cols.map(([sourceColumn, targetField]) => ({
    sourceColumn,
    targetField,
    confidence: 100,
    isAutoMapped: true,
    needsConfirmation: false,
  }));

describe("rowToRider (import → rider registration)", () => {
  it("keeps bib and standing as two distinct fields", () => {
    const rider = rowToRider(
      ["Dana", "Levi", "Men Elite", "345", "12"],
      map([["fn", "firstName"], ["ln", "lastName"], ["cat", "category"], ["bib", "bibNumber"], ["rank", "standing"]]),
      "race-1",
      0
    );
    expect(rider.bibNumber).toBe(345);
    expect(rider.standing).toBe(12);
    expect(rider.category).toBe("Men Elite");
  });

  it("maps the position column to position_start, not to the bib", () => {
    const rider = rowToRider(["7", "345"], map([["pos", "position"], ["bib", "bibNumber"]]), "race-1", 0);
    expect(rider.position_start).toBe(7);
    expect(rider.bibNumber).toBe(345);
  });

  it("defaults a missing / unparsable bib to 0 and standing to null", () => {
    const rider = rowToRider(["abc"], map([["bib", "bibNumber"]]), "race-1", 0);
    expect(rider.bibNumber).toBe(0);
    expect(rider.standing).toBeNull();
  });

  it("splits a full name column into first and last name", () => {
    const rider = rowToRider(["Dana Levi"], map([["name", "fullName"]]), "race-1", 0);
    expect(rider.firstName).toBe("Dana");
    expect(rider.lastName).toBe("Levi");
  });

  it("starts every rider unchecked, upcoming, with no laps", () => {
    const rider = rowToRider(["1"], map([["bib", "bibNumber"]]), "race-1", 0);
    expect(rider).toMatchObject({ checked: false, status: "standing", raceStatus: "upcoming", lapsCounter: 0, raceUuid: "race-1" });
  });

  it("gives riders in the same import distinct ids", () => {
    const m = map([["bib", "bibNumber"]]);
    const a = rowToRider(["1"], m, "race-1", 0);
    const b = rowToRider(["2"], m, "race-1", 1);
    expect(a.id).not.toBe(b.id);
  });

  it("keeps Hebrew names intact", () => {
    const rider = rowToRider(["דנה", "לוי"], map([["fn", "firstName"], ["ln", "lastName"]]), "race-1", 0);
    expect(rider.firstName).toBe("דנה");
    expect(rider.lastName).toBe("לוי");
  });

  it("stores 'keep as info' columns under their original header", () => {
    const rider = rowToRider(["Note!"], map([["Remarks", "infoField"]]), "race-1", 0);
    expect(rider.extraFields).toEqual({ Remarks: "Note!" });
  });
});

describe("import row filter (repeated headers created an extra wave)", () => {
  // Synthetic start list: one table per wave, each repeating the header row —
  // the layout that created "Wave 9" with riders named "שם פרטי שם משפחה".
  const headers = ["מספר רוכב", "שם פרטי", "שם משפחה", "קטגוריה", "מקצה", "שעת זינוק"];
  const mappings = map([
    ["מספר רוכב", "bibNumber"], ["שם פרטי", "firstName"], ["שם משפחה", "lastName"],
    ["קטגוריה", "category"], ["מקצה", "heat"], ["שעת זינוק", "startTime"],
  ]);
  const rows: string[][] = [];
  for (let w = 1; w <= 8; w++) {
    if (w > 1) rows.push([...headers]); // the header again before each wave's table
    rows.push([String(100 + w), `Rider${w}`, "Test", `Cat ${w}`, `מקצה ${w}`, `09:${String(w).padStart(2, "0")}`]);
    rows.push([String(200 + w), `Rider${w}b`, "Test", `Cat ${w}`, `מקצה ${w}`, `09:${String(w).padStart(2, "0")}`]);
  }
  rows.push(["", "", "", "", "", ""]); // blank row
  rows.push(["  ", "", " ", "", "", ""]); // whitespace-only row
  rows.push(["רשימת זינוק - מקצה 9", "", "", "", "", ""]); // a title row: no bib, no name

  it("skips repeated headers, blank and invalid rows, with a reason for each", () => {
    const { rows: kept, skipped } = filterImportRows(rows, headers, mappings);
    expect(kept).toHaveLength(16);
    expect(skipped.filter((s) => s.reason === "header")).toHaveLength(7);
    expect(skipped.filter((s) => s.reason === "blank")).toHaveLength(2);
    expect(skipped.filter((s) => s.reason === "invalid")).toHaveLength(1);
  });

  it("numbers only the real waves: 8 waves, no wave 9, no rider named after the columns", () => {
    const { rows: kept } = filterImportRows(rows, headers, mappings);
    const heatMap = buildHeatNameMap(kept, mappings);
    const riders = kept.map((r, i) => rowToRider(r, mappings, "race-1", i, heatMap));
    expect([...new Set(riders.map((r) => r.heat))].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(riders.some((r) => r.firstName === "שם פרטי" || r.category === "קטגוריה")).toBe(false);
    expect(riders.every((r) => r.bibNumber > 0)).toBe(true);
  });

  it("without the filter the same file produced the bug (documents the root cause)", () => {
    // The header text got its own wave number (the next free one at its first
    // appearance: 9 when the repeated headers follow all eight waves).
    const heatMap = buildHeatNameMap(rows, mappings);
    expect(heatMap.size).toBe(9);
    const wave = heatMap.get("מקצה");
    expect(wave).toBeGreaterThan(0);
    const header = rowToRider([...headers], mappings, "race-1", 0, heatMap);
    expect([header.firstName, header.lastName, header.category, header.heat, header.bibNumber]).toEqual(["שם פרטי", "שם משפחה", "קטגוריה", wave, 0]);
    // Headers after all real waves → exactly the reported "Wave 9".
    const tail = [...rows.filter((r) => r[1] !== "שם פרטי"), [...headers]];
    expect(buildHeatNameMap(tail, mappings).get("מקצה")).toBe(9);
  });

  it("keeps real riders: a name without a bib, or a bib without a name", () => {
    expect(importSkipReason(["", "Dana", "Levi", "Cat", "1", ""], headers, mappings)).toBeNull();
    expect(importSkipReason(["57", "", "", "Cat", "1", ""], headers, mappings)).toBeNull();
    // A rider whose team happens to equal one header cell is not a header row.
    expect(importSkipReason(["58", "Dana", "קטגוריה", "Cat", "1", ""], headers, mappings)).toBeNull();
  });
});
