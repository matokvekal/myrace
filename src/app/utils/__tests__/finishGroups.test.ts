import { describe, it, expect } from "vitest";
import { finishGroupLabel, finishGroupOptions } from "../finishGroups";

describe("Finish Group labels and options", () => {
  it("labels None and numbered groups, and keeps older free-text values", () => {
    expect(finishGroupLabel("")).toBe("None");
    expect(finishGroupLabel(undefined)).toBe("None");
    expect(finishGroupLabel(" 2 ")).toBe("Finish Group 2");
    expect(finishGroupLabel("Masters")).toBe("Finish Group Masters");
  });

  it("offers None, 1–3 at least, one free number past the highest used, then legacy values", () => {
    expect(finishGroupOptions([])).toEqual(["", "1", "2", "3"]);
    expect(finishGroupOptions([{ linkGroup: "4" }, { linkGroup: "1" }])).toEqual(["", "1", "2", "3", "4", "5"]);
    expect(finishGroupOptions([{ linkGroup: "Masters" }, { linkGroup: "1" }])).toEqual(["", "1", "2", "3", "Masters"]);
  });
});
