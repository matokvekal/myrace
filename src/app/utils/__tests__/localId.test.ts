import { describe, expect, it } from "vitest";
import { duplicateIds, newLocalId } from "../localId";

describe("local record ids", () => {
  it("are unique even when a whole race is created in one loop (the missing-cards bug)", () => {
    // 183 riders pulled from the server in one tick used to lose ~16 of them to id collisions.
    for (let run = 0; run < 50; run++) {
      const ids = Array.from({ length: 2000 }, () => newLocalId());
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("are safe integers that keep increasing", () => {
    const a = newLocalId();
    const b = newLocalId();
    expect(Number.isSafeInteger(a)).toBe(true);
    expect(b).toBeGreaterThan(a);
  });

  it("finds duplicated ids", () => {
    expect([...duplicateIds([{ id: 1 }, { id: 2 }, { id: 1 }, { id: 3 }, { id: 2 }])].sort()).toEqual([1, 2]);
    expect(duplicateIds([{ id: 1 }, { id: 2 }]).size).toBe(0);
  });
});
