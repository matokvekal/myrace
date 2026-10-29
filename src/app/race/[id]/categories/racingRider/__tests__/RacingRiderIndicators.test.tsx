import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import RacingRider from "../RacingRider";
import { makeRider } from "@/test/factories";
import type { RiderPhase } from "../../../../../../shared/race/finishPhases";

const noop = () => {};
const T0 = Date.parse("2026-06-01T10:00:00Z");
const rider = (lapsCounter: number, raceStatus: "running" | "finished" = "running") =>
  makeRider({ bibNumber: 7, totalLaps: 5, lapsCounter, raceStatus,
    lapsDetails: Array.from({ length: lapsCounter }, (_, i) => ({ lap: i + 1, endTime: new Date(T0 + (i + 1) * 300_000).toISOString() })) as never });
const bell = (c: HTMLElement) => c.querySelector('[data-testid="bell"]');
const flag = (c: HTMLElement) => c.querySelector('[data-testid="finish-flag"]');
const phase = (icon: RiderPhase["icon"], remaining: number, finishPhase = false): RiderPhase =>
  ({ icon, remaining, finishPhase, nextCrossingFinishes: icon === "flag" });

describe("RacingRider bell / flag icons (what to show at the NEXT crossing)", () => {
  it("own count: nothing at 3 to go, BELL at 2 to go, FLAG at 1 to go", () => {
    const at = (laps: number) => render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(laps)} color="#f00" />);
    const three = at(2);
    expect(bell(three.container)).toBeNull();
    expect(flag(three.container)).toBeNull();
    three.unmount();
    const two = at(3);
    expect(bell(two.container)).not.toBeNull();
    expect(two.getByText("2 left")).toBeTruthy();
    two.unmount();
    const one = at(4);
    expect(flag(one.container)).not.toBeNull();
    expect(bell(one.container)).toBeNull();
    expect(one.getByText("1 left")).toBeTruthy();
  });

  it("the group phase overrides the own count: BELL with 2 to go for a rider far from the end", () => {
    const { container, getByText } = render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(1)} color="#f00" phase={phase("bell", 2)} />);
    expect(bell(container)).not.toBeNull();
    expect(getByText("2 left")).toBeTruthy();
  });

  it("finish phase: FLAG with 0 to go, and the rider is not shown as finished", () => {
    const { container, getByText, queryByText } = render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(1)} color="#f00" phase={phase("flag", 0, true)} />);
    expect(flag(container)).not.toBeNull();
    expect(getByText("0 left")).toBeTruthy();
    expect(queryByText("Finished")).toBeNull();
  });

  it("an actually finished rider shows Finished, no bell and no flag", () => {
    const { container, getByText } = render(<RacingRider onClick={noop} onDoubleClick={noop} rider={rider(5, "finished")} color="#f00" phase={phase("finished", 0)} />);
    expect(getByText("Finished")).toBeTruthy();
    expect(bell(container)).toBeNull();
    expect(flag(container)).toBeNull();
  });
});
