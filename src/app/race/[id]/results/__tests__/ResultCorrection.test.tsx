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
// A t() that fills {{placeholders}} like the app's initialised i18next does.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, def: string, vars: Record<string, unknown> = {}) => def.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(vars[k] ?? "")),
  }),
}));
const raceState = vi.hoisted(() => ({ finalized: false }));
const history = vi.hoisted(() => ({ events: [] as Record<string, unknown>[], fail: false }));
vi.mock("@/services/live/liveClient", () => ({
  team: { history: async () => { if (history.fail) throw new Error("offline"); return { events: history.events }; } },
}));
vi.mock("@/stores/racesStore", () => ({
  default: (sel: (s: { races: { uuid: string; finalized?: unknown }[] }) => unknown) =>
    sel({ races: [{ uuid: "race-1", finalized: raceState.finalized ? { token: "t" } : undefined }] }),
}));

import ResultCorrection from "../ResultCorrection";

const base = { id: 1, uuid: "rider-uuid-1", lapsCounter: 3, bibNumber: 7, firstName: "A", lastName: "B", raceStatus: "finished", status: "finished" };
const rider = base as never;
const as = (over: Record<string, unknown>) => ({ ...base, ...over }) as never;

beforeEach(() => {
  bridge.live = true;
  bridge.canResults = true;
  bridge.allows = true;
  bridge.dispatch.mockReset();
  bridge.dispatch.mockResolvedValue("id");
  raceState.finalized = false;
  history.events = [];
  history.fail = false;
  vi.spyOn(window, "confirm").mockReturnValue(true);
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
    bridge.canResults = true;
    rerender(<ResultCorrection raceUuid="race-1" rider={as({ raceStatus: "upcoming", status: "standing" })} />);
    expect(container.innerHTML).toBe(""); // wave not started: a correction would start them with laps
  });

  it("sends a lap-count correction and a status correction, after confirming", async () => {
    render(<ResultCorrection raceUuid="race-1" rider={rider} />);
    expect(screen.getByTestId("correct-laps-save")).toBeDisabled(); // unchanged count
    fireEvent.change(screen.getByTestId("correct-laps"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("correct-laps-save"));
    expect(bridge.dispatch).toHaveBeenCalledWith("race-1", "LapCountCorrection", { riderUuid: "rider-uuid-1", laps: 5 });
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/5 laps \(now 3\)/));
    await screen.findByRole("status");
    fireEvent.click(screen.getByTestId("correct-status-DSQ"));
    expect(bridge.dispatch).toHaveBeenCalledWith("race-1", "StatusCorrection", { riderUuid: "rider-uuid-1", status: "DSQ" });
  });

  it("nothing is sent when the confirm is cancelled", () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<ResultCorrection raceUuid="race-1" rider={rider} />);
    fireEvent.click(screen.getByTestId("correct-status-DNF"));
    expect(bridge.dispatch).not.toHaveBeenCalled();
  });

  it("Clear is offered only to undo DNF/DSQ/DNS — never on a finisher (it would put them back on course)", () => {
    const { rerender } = render(<ResultCorrection raceUuid="race-1" rider={rider} />);
    expect(screen.queryByTestId("correct-status-clear")).toBeNull();
    rerender(<ResultCorrection raceUuid="race-1" rider={as({ status: "DSQ" })} />);
    expect(screen.getByTestId("correct-status-DSQ")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("correct-status-clear"));
    expect(bridge.dispatch).toHaveBeenCalledWith("race-1", "StatusCorrection", { riderUuid: "rider-uuid-1", status: "running" });
  });

  it("a failed send is shown, not thrown", async () => {
    bridge.dispatch.mockRejectedValue(new Error("Not a shared race"));
    render(<ResultCorrection raceUuid="race-1" rider={rider} />);
    fireEvent.click(screen.getByTestId("correct-status-DNF"));
    expect(await screen.findByRole("status")).toHaveTextContent(/Could not send: Not a shared race/);
  });

  it("refuses up front when the role doesn't allow it (nothing sent)", async () => {
    bridge.allows = false;
    render(<ResultCorrection raceUuid="race-1" rider={rider} />);
    fireEvent.click(screen.getByTestId("correct-status-DNF"));
    expect(await screen.findByRole("status")).toHaveTextContent(/doesn't allow/);
    expect(bridge.dispatch).not.toHaveBeenCalled();
  });

  it("offers Undo for the latest correction still in effect (from history) and sends a new Undo event", async () => {
    history.events = [
      { type: "AddLap", applied: true, actionId: "lap-1" },
      { type: "LapCountCorrection", applied: true, undone: false, actionId: "fix-1", laps: 2 },
    ];
    render(<ResultCorrection raceUuid="race-1" rider={as({ uuid: "rider-uuid-9" })} />);
    fireEvent.click(await screen.findByTestId("correct-laps-undo"));
    expect(bridge.dispatch).toHaveBeenCalledWith("race-1", "Undo", { targetActionId: "fix-1" });
    expect(await screen.findByRole("status")).toHaveTextContent(/undone/);
  });

  it("no Undo when the latest correction was already undone", async () => {
    history.events = [{ type: "LapCountCorrection", applied: true, undone: true, actionId: "fix-1", laps: 2 }];
    render(<ResultCorrection raceUuid="race-1" rider={as({ uuid: "rider-uuid-8" })} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("correct-laps-undo")).toBeNull();
  });

  it("after the newest correction was undone, offers Undo for the older one still in effect", async () => {
    history.events = [
      { type: "LapCountCorrection", applied: true, undone: false, actionId: "fix-old", laps: 1 },
      { type: "LapCountCorrection", applied: true, undone: true, actionId: "fix-new", laps: 4 },
    ];
    render(<ResultCorrection raceUuid="race-1" rider={as({ uuid: "rider-uuid-7" })} />);
    fireEvent.click(await screen.findByTestId("correct-laps-undo"));
    expect(bridge.dispatch).toHaveBeenCalledWith("race-1", "Undo", { targetActionId: "fix-old" });
  });

  it("picks the newest correction by event time (an offline one delivered late is older)", async () => {
    history.events = [
      { type: "LapCountCorrection", applied: true, undone: false, actionId: "made-later", laps: 4, seq: 10, eventAt: "2026-11-06T10:05:00Z" },
      { type: "LapCountCorrection", applied: true, undone: false, actionId: "made-earlier-offline", laps: 1, seq: 11, eventAt: "2026-11-06T10:01:00Z" },
    ];
    render(<ResultCorrection raceUuid="race-1" rider={as({ uuid: "rider-uuid-6" })} />);
    fireEvent.click(await screen.findByTestId("correct-laps-undo"));
    expect(bridge.dispatch).toHaveBeenCalledWith("race-1", "Undo", { targetActionId: "made-later" });
  });

  it("0.3.5: Correct name sends an audited RiderNameCorrected with a required reason", async () => {
    render(<ResultCorrection raceUuid="race-1" rider={rider} />);
    fireEvent.click(screen.getByTestId("correct-name-open"));
    fireEvent.change(screen.getByTestId("correct-name-last"), { target: { value: "Bee" } });
    expect(screen.getByTestId("correct-name-save")).toBeDisabled(); // no reason yet
    fireEvent.change(screen.getByTestId("correct-name-reason"), { target: { value: "Spelling" } });
    fireEvent.click(screen.getByTestId("correct-name-save"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/"A Bee".*reason/));
    expect(bridge.dispatch).toHaveBeenCalledWith("race-1", "RiderNameCorrected", { riderUuid: "rider-uuid-1", changes: { lastName: "Bee" }, reason: "Spelling" });
    await screen.findByText("Name correction sent.");
  });
});
