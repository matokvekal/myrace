import { describe, it, expect } from "vitest";
import { extractNumbers, pickBibsFromAlternatives } from "../numberParser";

describe("extractNumbers", () => {
  it("reads digit strings and number words", () => {
    expect(extractNumbers("47 52", "en")).toEqual([47, 52]);
    expect(extractNumbers("forty seven", "en")).toEqual([47]);
    expect(extractNumbers("עשרים ושלוש", "he")).toEqual([23]);
    expect(extractNumbers("אחד שתיים שלוש", "he")).toEqual([1, 2, 3]);
  });

  it("keeps BOTH digits and words in a mixed phrase, in spoken order", () => {
    expect(extractNumbers("47 ושלושים", "he")).toEqual([47, 30]);
    expect(extractNumbers("twelve 47 nine", "en")).toEqual([12, 47, 9]);
  });

  it("ignores zero, out-of-range and non-number words", () => {
    expect(extractNumbers("0 10000 rider", "en")).toEqual([]);
    expect(extractNumbers("", "en")).toEqual([]);
  });
});

describe("pickBibsFromAlternatives", () => {
  const bibs = new Set(["47", "12", "30"]);

  it("takes the first guess when every number in it is a real bib", () => {
    expect(pickBibsFromAlternatives(["47 12", "57 12"], "en", bibs)).toEqual(["47", "12"]);
  });

  it("falls back to a lower guess when the top one heard a bib that isn't racing", () => {
    expect(pickBibsFromAlternatives(["57", "47"], "en", bibs)).toEqual(["47"]);
  });

  it("otherwise uses the guess with the most real bibs", () => {
    expect(pickBibsFromAlternatives(["57 12", "47 12 99"], "en", bibs)).toEqual(["47", "12"]);
  });

  it("reports each bib once and nothing when no guess has a real bib", () => {
    expect(pickBibsFromAlternatives(["47 47"], "en", bibs)).toEqual(["47"]);
    expect(pickBibsFromAlternatives(["88", "hello"], "en", bibs)).toEqual([]);
  });
});
