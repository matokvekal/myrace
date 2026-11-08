import { describe, expect, it } from "vitest";
import { undoWindowExpired } from "../src/races/actions.js";
import { LAP_UNDO_WINDOW_MS } from "../../src/shared/race/actions.js";

describe("0.3 live Undo window (server receive times)", () => {
  const at = 1_000_000;
  it("a recorded lap can be undone within 30 s, not after", () => {
    expect(LAP_UNDO_WINDOW_MS).toBe(30_000);
    for (const type of ["AddLap", "RiderFinished"]) {
      expect(undoWindowExpired({ type, receivedAt: at }, at)).toBe(false); // same batch
      expect(undoWindowExpired({ type, receivedAt: at }, at + 30_000)).toBe(false);
      expect(undoWindowExpired({ type, receivedAt: at }, at + 30_001)).toBe(true);
    }
  });
  it("audited corrections are never windowed", () => {
    expect(undoWindowExpired({ type: "LapCountCorrection", receivedAt: at }, at + 3_600_000)).toBe(false);
  });
});
