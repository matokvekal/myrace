/** Race-day wave card: Live is the big action while racing; Finish Wave takes over once everyone is in. */
import React from "react";
import { describe, it, expect, beforeAll } from "vitest";

// jsdom has no scrolling; the timeline scrolls to the current wave on mount.
beforeAll(() => {
  Element.prototype.scrollTo ??= function () {} as typeof Element.prototype.scrollTo;
});
import { render, screen } from "@testing-library/react";
import WaveTimeline from "../WaveTimeline";
import type { CategoryProps, RiderProps } from "@/types/types";

const cat = (status: string, id = 1, name = "Men Open") =>
  ({ id, uuid: `c${id}`, raceUuid: "r", name, subCategory: null, heat: "1", startTime: "09:00", status, laps: 3 }) as unknown as CategoryProps;
const rider = (id: number, raceStatus: string, status = "", category = "Men Open") =>
  ({ id, raceUuid: "r", category, subCategory: null, raceStatus, status, checked: true }) as unknown as RiderProps;

function show(cats: CategoryProps[], riders: RiderProps[]) {
  const schedule = new Map([[1, new Map([["09:00", cats]])]]);
  render(
    <WaveTimeline
      schedule={schedule}
      states={new Map([[1, "running"]])}
      riders={riders}
      selected={1}
      onSelect={() => {}}
      onAction={() => {}}
    />,
  );
  return { live: screen.getByTestId("wave-act-live-1"), finish: screen.getByTestId("wave-act-finish-1") };
}

describe("wave card actions while a wave runs", () => {
  it("riders on course: Live is the big primary button, Finish small", () => {
    const { live, finish } = show([cat("running")], [rider(1, "running"), rider(2, "finished")]);
    expect(live).toHaveAttribute("data-primary", "true");
    expect(finish).not.toHaveAttribute("data-primary");
    expect(finish).toHaveTextContent(/^\s*Finish\s*$/);
  });

  it("everyone in (finished / DNF): Finish Wave becomes the big button, Live small", () => {
    const { live, finish } = show([cat("running")], [rider(1, "finished"), rider(2, "running", "DNF")]);
    expect(finish).toHaveAttribute("data-primary", "true");
    expect(finish).toHaveTextContent("Finish Wave");
    expect(live).not.toHaveAttribute("data-primary");
  });

  it("a later start group still waiting: Live stays primary even if nobody is on course", () => {
    const { live, finish } = show(
      [cat("running", 1), cat("upcoming", 2, "Women Open")],
      [rider(1, "finished"), rider(2, "upcoming", "", "Women Open")],
    );
    expect(live).toHaveAttribute("data-primary", "true");
    expect(finish).not.toHaveAttribute("data-primary");
  });
});
