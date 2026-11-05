import { describe, it, expect } from "vitest";
import { previewStartListRows } from "../startListPreview";

/** The Create Race import preview: what will be created, warnings, nothing saved. */
describe("start-list preview", () => {
  it("counts riders, categories and waves; reports skipped header/blank rows and warnings", async () => {
    const header = ["Bib", "First Name", "Last Name", "Category", "Heat"];
    const rows = [
      header,
      ["101", "Dana", "Levi", "Elite", "1"],
      ["102", "Noa", "Bar", "Elite", "1"],
      header, // repeated header
      ["", "", "", "", ""], // blank
      ["102", "Avi", "Cohen", "Juniors", "2"], // duplicate bib
      ["", "Yossi", "Mizrahi", "Juniors", "2"], // no bib
    ];
    const p = await previewStartListRows(rows);
    expect(p.riders).toBe(4);
    expect(p.waves).toEqual([{ wave: 1, riders: 2 }, { wave: 2, riders: 2 }]);
    expect(p.categories.map((c) => `${c.wave}:${c.name}:${c.riders}`)).toEqual(["1:Elite:2", "2:Juniors:2"]);
    expect(p.skipped.map((s) => s.reason).sort()).toEqual(["blank", "header"]);
    expect(p.warnings.join(" | ")).toMatch(/Duplicate bib numbers: 102/);
    expect(p.warnings.join(" | ")).toMatch(/1 rider\(s\) without a bib number/);
    expect(p.warnings.join(" | ")).toMatch(/repeated header row/);
  });

  it("refuses a file without a bib or name column", async () => {
    await expect(previewStartListRows([["Foo", "Bar"], ["1", "2"]])).rejects.toThrow(/Required column/);
  });
});
