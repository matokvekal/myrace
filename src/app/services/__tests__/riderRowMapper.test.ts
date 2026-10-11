import { describe, it, expect } from "vitest";
import { rowToRider } from "../riderRowMapper";
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
