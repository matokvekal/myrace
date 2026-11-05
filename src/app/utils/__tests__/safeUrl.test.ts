import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "../safeUrl";

describe("safeHttpUrl", () => {
  it("keeps http(s), adds https to a bare domain, refuses everything else", () => {
    expect(safeHttpUrl("https://a.org/rules.pdf")).toBe("https://a.org/rules.pdf");
    expect(safeHttpUrl("a.org/rules")).toBe("https://a.org/rules");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("not a link")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});
