import { describe, it, expect } from "vitest";
import { rowToRider } from "../riderRowMapper";
import { autoMapColumns } from "../csvMapper";
import { isIdColumnHeader } from "@/types/csv.types";
import type { ColumnMapping } from "@/types/csv.types";

/**
 * Story 1.3 / PRD FR-45 — national ID and passport numbers are never stored.
 * A start list may contain such a column: the import succeeds and the column
 * is skipped, whatever it was mapped to.
 */

const map = (cols: [string, ColumnMapping["targetField"]][]): ColumnMapping[] =>
  cols.map(([sourceColumn, targetField]) => ({
    sourceColumn,
    targetField,
    confidence: 100,
    isAutoMapped: false,
    needsConfirmation: false,
  }));

describe("isIdColumnHeader", () => {
  it.each(["ID", "ID Number", "id no", "Passport", "Passport Number", "National ID", 'ת"ז', "ת״ז", "תז", "תז/דרכון", 'ת"ז/דרכון', "תעודת זהות", "מספר זהות", "דרכון", "מספר דרכון", "  ID  "])(
    "recognises %s",
    (h) => expect(isIdColumnHeader(h)).toBe(true)
  );

  it.each(["bib", "מספר רוכב", "מספר", "ID UCI", "UCI ID", "מספר UCI", "Chip", "Federation Number", "שם פרטי", "Birth Date"])(
    "does not flag %s",
    (h) => expect(isIdColumnHeader(h)).toBe(false)
  );
});

describe("rowToRider never stores ID values", () => {
  it("drops an ID column even when it was manually kept as info", () => {
    const rider = rowToRider(
      ["Dana", "Levi", "123456789", "Men Elite"],
      map([["first", "firstName"], ["last", "lastName"], ['ת"ז/דרכון', "infoField"], ["cat", "category"]]),
      "race-1",
      0
    );
    expect(rider.firstName).toBe("Dana");
    expect(rider.category).toBe("Men Elite");
    expect(JSON.stringify(rider)).not.toContain("123456789");
    expect(rider.extraFields ?? {}).not.toHaveProperty('ת"ז/דרכון');
  });

  it("drops an ID column mapped to any other field (e.g. a saved template)", () => {
    const rider = rowToRider(
      ["987654321", "7"],
      map([["Passport", "notes"], ["bib", "bibNumber"]]),
      "race-1",
      0
    );
    expect(rider.bibNumber).toBe(7);
    expect(JSON.stringify(rider)).not.toContain("987654321");
  });
});

describe("autoMapColumns skips ID columns", () => {
  const hebrewStartList = ["דירוג", "מקצה", "קטגוריה", "שם אגודה", 'ת"ז/דרכון', "שם פרטי", "שם משפחה", "מספר"];

  it("leaves the ID column unmapped", async () => {
    const mappings = await autoMapColumns(hebrewStartList);
    const id = mappings.find((m) => m.sourceColumn === 'ת"ז/דרכון')!;
    expect(id.targetField).toBeNull();
    expect(mappings.find((m) => m.sourceColumn === "שם פרטי")!.targetField).toBe("firstName");
    expect(mappings.find((m) => m.sourceColumn === "קטגוריה")!.targetField).toBe("category");
  });

  it("maps every other column exactly as it would without the ID column", async () => {
    const withId = await autoMapColumns(hebrewStartList);
    const withoutId = await autoMapColumns(hebrewStartList.filter((h) => h !== 'ת"ז/דרכון'));
    const pick = (ms: ColumnMapping[]) =>
      ms.filter((m) => m.sourceColumn !== 'ת"ז/דרכון').map((m) => [m.sourceColumn, m.targetField]);
    expect(pick(withId)).toEqual(pick(withoutId));
  });
});

describe("legacy ID values never leave the device", () => {
  it("withoutIdFields drops ID / passport entries and keeps the rest", async () => {
    const { withoutIdFields } = await import("@/types/csv.types");
    expect(withoutIdFields({ "ID Number": "123456789", "UCI Number": "10012345678", Notes: "x" })).toEqual({
      "UCI Number": "10012345678",
      Notes: "x",
    });
    expect(withoutIdFields({ 'ת"ז/דרכון': "1" })).toBeUndefined();
    expect(withoutIdFields(undefined)).toBeUndefined();
  });
});
