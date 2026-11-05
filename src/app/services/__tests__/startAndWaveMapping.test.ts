import { describe, expect, it } from "vitest";
import { autoMapColumns } from "../csvMapper";

const fieldsOf = async (headers: string[], rows: string[][]) =>
  Object.fromEntries((await autoMapColumns(headers, rows)).map((m) => [m.sourceColumn, m.targetField]));

/** Start lists: "זינוק" is not a wave, "מקצה" is the category, waves come from start times. */
describe("auto-mapping of start / wave / class columns", () => {
  it("a bare 'זינוק' holding group labels is left for the user to map (not Wave, not Start Time)", async () => {
    const m = await fieldsOf(["מספר רוכב", "שם מלא", "זינוק", "מקצה", "שעה"], [["1", "Dana Levi", "זינוק 1", "ילדים 13", "08:20"]]);
    expect(m["זינוק"]).toBeNull();
    expect(m["מקצה"]).toBe("category");
    expect(m["שעה"]).toBe("startTime");
  });

  it("a bare 'זינוק' holding clock times is the start time", async () => {
    const m = await fieldsOf(["מספר רוכב", "שם מלא", "זינוק", "קטגוריה"], [["1", "a", "08:20", "x"], ["2", "b", "08:25:30", "y"]]);
    expect(m["זינוק"]).toBe("startTime");
  });

  it("'שעת זינוק' is the start time, never the wave", async () => {
    const m = await fieldsOf(["bib", "name", "מקצה", "שעת זינוק"], [["1", "a", "x", "08:20"]]);
    expect(m["שעת זינוק"]).toBe("startTime");
    expect(Object.values(m)).not.toContain("heat");
  });

  it("only an explicit wave column becomes the wave", async () => {
    expect((await fieldsOf(["bib", "name", "גל", "category"], [["1", "a", "1", "x"]]))["גל"]).toBe("heat");
    expect((await fieldsOf(["bib", "name", "Wave", "category"], [["1", "a", "1", "x"]]))["Wave"]).toBe("heat");
    expect((await fieldsOf(["bib", "name", "קבוצת זינוק", "category"], [["1", "a", "A", "x"]]))["קבוצת זינוק"]).not.toBe("heat");
  });

  it("a real 'קטגוריה' column wins over 'מקצה'", async () => {
    const m = await fieldsOf(["מספר רוכב", "שם מלא", "מקצה", "קטגוריה"], [["1", "a", "x", "y"]]);
    expect(m["קטגוריה"]).toBe("category");
    expect(m["מקצה"]).toBeNull();
  });
});
