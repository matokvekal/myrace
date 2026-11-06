/**
 * Results judge (0.2): the correction panel shows only on a shared, non-final race for a role
 * that updates Results, and sends LapCountCorrection / StatusCorrection.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const bridge = vi.hoisted(() => ({
  live: true,
  canResults: true,
  allows: true,
  dispatch: vi.fn(async () => "id"),
}));
vi.mock("@/services/live/liveBridge", () => ({
  isLiveRace: () => bridge.live,
  canOnScreen: (_r: string, screen: string, op: string) => screen === "results" && op === "update" && bridge.canResults,
  liveAllows: () => bridge.allows,
  liveDispatch: bridge.dispatch,
}));
const raceState = vi.hoisted(() => ({ finalized: false }));
vi.mock("@/stores/racesStore", () => ({
  default: (sel: (s: { races: { uuid: string; finalized?: unknown }[] }) => unknown) =>
    sel({ races: [{ uuid: "race-1", finalized: raceState.finalized ? { token: "t" } : undefined }] }),
}));

import ResultCorrection from "../ResultCorrection";

const rider = { id: 1, uuid: "rider-uuid-1", lapsCounter: 3, bibNumber: 7, firstName: "A", lastName: "B" } as never;

beforeEach(() => {
  bridge.live = true;
  bridge.canResults = true;
  bridge.allows = true;
  bridge.dispatch.mockClear();
  raceState.finalized = false;
});

describe("ResultCorrection", () => {
  it("hidden for a local race, a final race, and a role without Results update", () => {
    bridge.live = false;
    const { container, rerender } = render(<ResultCorrection raceUuid="race-1" rider={rider} />);
    expect(container.innerHTML).toBe("");
    bridge.live = true;
    raceState.finalized = true;
    rerender(<ResultCorrection raceUuid="race-1" rider={rider} />);
    expect(container.innerHTML).toBe("");
    raceState.finalized = false;
    bridge.canResults = false;
    rerender(<ResultCorrection raceUuid="race-1" rider={rider} />);
    expect(container.innerHTML).toBe("");
  });

  it("sends a lap-count correction and a status correction", () => {
    render(<ResultCorrection raceUuid="race-1" rider={rider} />);
    expect(screen.getByTestId("correct-laps-save")).toBeDisabled(); // unchanged count
    fireEvent.change(screen.getByTestId("correct-laps"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("correct-laps-save"));
    expect(bridge.dispatch).toHaveBeenCalledWith("race-1", "LapCountCorrection", { riderUuid: "rider-uuid-1", laps: 5 });
    fireEvent.click(screen.getByTestId("correct-status-DSQ"));
    expect(bridge.dispatch).toHaveBeenCalledWith("race-1", "StatusCorrection", { riderUuid: "rider-uuid-1", status: "DSQ" });
  });

  it("refuses up front when the role doesn't allow it (nothing sent)", async () => {
    bridge.allows = false;
    render(<ResultCorrection raceUuid="race-1" rider={rider} />);
    fireEvent.click(screen.getByTestId("correct-status-DNF"));
    expect(await screen.findByRole("status")).toHaveTextContent(/doesn't allow/);
    expect(bridge.dispatch).not.toHaveBeenCalled();
  });
});
