import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));

import Riders from "../Riders";
import useRiderStore from "@/stores/ridersStore";
import { makeCategory, makeRider } from "@/test/factories";

/** Collapse All / Expand All (global resets) and +/− per group — display only. */
const RACE = "race-1";
const cats = [makeCategory({ name: "Elite", heat: 1, startTime: "09:00" }), makeCategory({ name: "Juniors", heat: 2, startTime: "11:00" })];
const riders = [
  makeRider({ category: "Elite", bibNumber: 11, firstName: "Dana", lastName: "Levi" }),
  makeRider({ category: "Juniors", bibNumber: 31, firstName: "Noa", lastName: "Bar" }),
];
const shown = (name: RegExp) => screen.queryAllByText(name).length > 0;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  useRiderStore.setState({ riders, lastFetchedRaceUuid: RACE });
});

describe("Riders → collapse and expand groups", () => {
  it("starts expanded; Collapse All / Expand All reset every group; +/− toggles one group", async () => {
    const user = userEvent.setup();
    render(<Riders raceUuid={RACE} categories={cats} />);
    expect(shown(/Levi Dana/)).toBe(true);
    expect(shown(/Bar Noa/)).toBe(true);
    // Both global buttons are always shown.
    expect(screen.getByTestId("collapse-all")).toBeTruthy();
    expect(screen.getByTestId("expand-all")).toBeTruthy();

    // One group by its −; the other stays open.
    await user.click(screen.getByRole("button", { name: "Collapse Elite" }));
    expect(shown(/Levi Dana/)).toBe(false);
    expect(shown(/Bar Noa/)).toBe(true);

    // Expand All overrides the individual choice.
    await user.click(screen.getByTestId("expand-all"));
    expect(shown(/Levi Dana/)).toBe(true);

    // Collapse All closes every group, whatever its state; headers and counts stay.
    await user.click(screen.getByTestId("collapse-all"));
    expect(shown(/Levi Dana/)).toBe(false);
    expect(shown(/Bar Noa/)).toBe(false);
    expect(screen.getAllByTestId("rider-category-header").map((h) => h.textContent)).toEqual([expect.stringMatching(/Elite.*1/), expect.stringMatching(/Juniors.*1/)]);

    // Then a single group can be opened again with +.
    await user.click(screen.getByRole("button", { name: "Expand Juniors" }));
    expect(shown(/Bar Noa/)).toBe(true);
    expect(shown(/Levi Dana/)).toBe(false);

    // Display only: rider data untouched.
    expect(useRiderStore.getState().riders).toEqual(riders);
  });
});
