import { describe, expect, it } from "vitest";
import { buildTimelineAxis, timelineRange } from "../timelineAxis";

const PX = 2;
const GAP = 10;

describe("timelineRange", () => {
  it("runs from 1 hour before the first start to 2 hours after the last", () => {
    expect(timelineRange([510, 600, 690], [null, null, null])).toEqual({ from: 450, to: 810 });
  });

  it("keeps a wave that runs past the range in view", () => {
    expect(timelineRange([510], [800])).toEqual({ from: 450, to: 800 });
  });

  it("stays inside the day", () => {
    expect(timelineRange([30, 1400], [null, null])).toEqual({ from: 0, to: 1440 });
  });
});

describe("buildTimelineAxis", () => {
  const range = { from: 450, to: 720 };

  it("never lets a card reach the next wave, however close the starts are", () => {
    const waves = [
      { start: 510, height: 200 },
      { start: 520, height: 150 },
      { start: 520, height: 150 },
      { start: 600, height: 90 },
    ];
    const { tops } = buildTimelineAxis(waves, range, PX, GAP);
    waves.slice(1).forEach((_, i) => {
      expect(tops[i + 1]).toBeGreaterThanOrEqual(tops[i] + waves[i].height + GAP);
    });
  });

  it("keeps the plain scale where the cards already fit", () => {
    const { tops, toY } = buildTimelineAxis([{ start: 510, height: 100 }, { start: 600, height: 100 }], range, PX, GAP);
    expect(tops).toEqual([120, 300]);
    expect(toY(450)).toBe(0);
    expect(toY(540)).toBe(180);
  });

  it("puts each time at its true place between the waves and keeps time in order", () => {
    const { toY } = buildTimelineAxis([{ start: 510, height: 400 }, { start: 540, height: 100 }], range, PX, GAP);
    expect(toY(510)).toBe(120);
    expect(toY(525)).toBe((120 + 530) / 2);
    expect(toY(540)).toBe(530);
    for (let m = 450; m < 720; m += 15) expect(toY(m + 15)).toBeGreaterThan(toY(m));
  });

  it("leaves room below a tall last card", () => {
    const { height, tops } = buildTimelineAxis([{ start: 700, height: 500 }], range, PX, GAP);
    expect(height).toBe(tops[0] + 500 + 60 * PX);
  });
});
