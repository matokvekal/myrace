import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import RacingRider from "../RacingRider";
import { makeRider } from "@/test/factories";

const noop = () => {};
const rider = (lapsCounter: number) =>
  makeRider({ bibNumber: 7, totalLaps: 5, lapsCounter, raceStatus: "running" });
const bell = (c: HTMLElement) => c.querySelector('[title^="2 laps left"]');
const flag = (c: HTMLElement) => c.querySelector('[title^="Last lap"]');

describe("RacingRider bell / flag indicators", () => {
  it("shows the individual bell preview at exactly 2 laps remaining", () => {
    const { container } = render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(3)} color="#f00" />);
    expect(bell(container)).not.toBeNull();
    expect(flag(container)).toBeNull();
  });

  it("shows nothing at 3 laps remaining", () => {
    const { container } = render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(2)} color="#f00" />);
    expect(bell(container)).toBeNull();
    expect(flag(container)).toBeNull();
  });

  it("a category-wide bell (forceBell) rings for a rider far from the end", () => {
    const { container } = render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(1)} color="#f00" forceBell />);
    expect(bell(container)).not.toBeNull();
  });

  it("the finish flag replaces the bell once the category-wide finish is on", () => {
    const { container } = render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(2)} color="#f00" forceBell forceFinish />);
    expect(flag(container)).not.toBeNull();
    expect(bell(container)).toBeNull();
  });

  it("shows the last-lap flag at 1 lap remaining", () => {
    const { container } = render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(4)} color="#f00" />);
    expect(flag(container)).not.toBeNull();
  });
});
