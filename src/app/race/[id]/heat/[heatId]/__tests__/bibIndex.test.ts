import { describe, expect, it } from "vitest";
import { bibKey, buildBibIndex } from "../rapidEntry/bibIndex";

describe("Rapid Entry bib index", () => {
  const idx = buildBibIndex([1, 18, 182, 341, 431]);

  it("accepts a complete, unambiguous bib", () => {
    expect(idx.classify("431")).toBe("complete");
    expect(idx.classify("182")).toBe("complete");
    expect(idx.classify("341")).toBe("complete");
  });

  it("never treats a bib that longer bibs start with as complete (1 / 18 / 182)", () => {
    expect(idx.classify("1")).toBe("ambiguous");
    expect(idx.classify("18")).toBe("ambiguous");
  });

  it("waits on an incomplete prefix", () => {
    expect(idx.classify("34")).toBe("prefix");
    expect(idx.classify("4")).toBe("prefix");
  });

  it("reports numbers no bib can become", () => {
    expect(idx.classify("5")).toBe("none");
    expect(idx.classify("1820")).toBe("none");
    expect(idx.classify("0")).toBe("none");
    expect(idx.classify("018")).toBe("none");
    expect(idx.classify("")).toBe("none");
  });

  it("lists continuations shortest first", () => {
    expect(idx.continuations("1")).toEqual(["18", "182"]);
    expect(idx.continuations("34")).toEqual(["341"]);
    expect(idx.continuations("431")).toEqual([]);
  });

  it("ignores missing, zero and non-numeric bibs and normalises leading zeros", () => {
    const i = buildBibIndex([null, undefined, 0, "abc", "007", " 42 "]);
    expect(i.classify("7")).toBe("complete");
    expect(i.classify("42")).toBe("complete");
    expect(bibKey("007")).toBe("7");
    expect(bibKey(0)).toBeNull();
  });
});
