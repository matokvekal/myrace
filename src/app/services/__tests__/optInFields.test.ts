import { describe, it, expect } from "vitest";
import { autoMapColumns } from "../csvMapper";
import { rowToRider } from "../riderRowMapper";
import type { ColumnMapping } from "@/types/csv.types";

const fieldsOf = async (headers: string[]) =>
  Object.fromEntries((await autoMapColumns(headers)).map((m) => [m.sourceColumn, m.targetField]));

describe("autoMapColumns leaves opt-in fields unselected", () => {
  it.each(["Birth Date", "תאריך לידה", "UCI ID", "Bib Color", "Bib Text Color"])(
    "%s stays unmapped and doesn't fall through to another field",
    async (header) => {
      const f = await fieldsOf(["מספר רוכב", "שם פרטי", header]);
      expect(f[header]).toBeNull();
      expect(f["מספר רוכב"]).toBe("bibNumber");
      expect(f["שם פרטי"]).toBe("firstName");
    }
  );

  it("still stores a birth date the user picked by hand", () => {
    const mappings = [
      { sourceColumn: "bib", targetField: "bibNumber" },
      { sourceColumn: "born", targetField: "birthDate" },
    ] as ColumnMapping[];
    expect(rowToRider(["7", "01/01/1990"], mappings, "race-1", 0).extraFields).toEqual({ "Birth Date": "01/01/1990" });
  });
});
