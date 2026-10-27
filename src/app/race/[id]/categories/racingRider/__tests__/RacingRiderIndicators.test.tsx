import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import RacingRider from "../RacingRider";
import { makeRider } from "@/test/factories";

const noop = () => {};
const rider = (lapsCounter: number, raceStatus: "running" | "finished" = "running") =>
  makeRider({ bibNumber: 7, totalLaps: 5, lapsCounter, raceStatus });
const bell = (c: HTMLElement) => c.querySelector('[data-testid="bell"]');
const flag = (c: HTMLElement) => c.querySelector('[data-testid="finish-flag"]');

describe("RacingRider bell / flag indicators", () => {
  it("shows nothing before the final lap (2 or 3 laps remaining)", () => {
    for (const laps of [2, 3]) {
      const { container, unmount } = render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(laps)} color="#f00" />);
      expect(bell(container)).toBeNull();
      expect(flag(container)).toBeNull();
      unmount();
    }
  });

  it("the rider's own final lap shows the bell, not a finish flag", () => {
    const { container } = render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(4)} color="#f00" />);
    expect(bell(container)).not.toBeNull();
    expect(flag(container)).toBeNull();
  });

  it("a category-wide bell (forceBell) rings for a rider far from the end", () => {
    const { container } = render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(1)} color="#f00" forceBell />);
    expect(bell(container)).not.toBeNull();
    expect(flag(container)).toBeNull();
  });

  it("finish phase: a rider who has not crossed yet keeps the bell and gets no finish flag", () => {
    const { container, getByText } = render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(2)} color="#f00" forceBell forceFinish />);
    expect(bell(container)).not.toBeNull();
    expect(flag(container)).toBeNull();
    expect(getByText("Finish")).toBeTruthy();
  });

  it("the finish flag appears only once this rider has actually finished", () => {
    const { container } = render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(3, "finished")} color="#f00" forceFinish />);
    expect(flag(container)).not.toBeNull();
    expect(bell(container)).toBeNull();
  });
});
