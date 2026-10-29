import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";

const { recordRaceEvent, canForRace, toast } = vi.hoisted(() => ({
  recordRaceEvent: vi.fn(),
  canForRace: vi.fn(),
  toast: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent }));
vi.mock("@/services/cloud/permissions", () => ({ canForRace }));
vi.mock("@/services/analytics/analyticsClient", () => ({ logAnalyticsEvent: vi.fn() }));
vi.mock("react-toastify", () => ({ toast }));

import { useLapRecording, MIN_LAP_MS } from "../useLapRecording";
import { makeRider } from "@/test/factories";
import type { RiderProps } from "@/types/types";

/**
 * Story 1.6 — cancelling a DNF / DSQ / DNS entry from the live action log
 * restores the previous status and never removes a lap (it used to fall into
 * the lap-undo path and decrement a lap while leaving the status).
 */

const START = new Date("2026-06-01T10:00:00.000Z");
const rider = (id: number, over: Partial<RiderProps> = {}) =>
  makeRider({ id, bibNumber: id, category: "Man Pro", raceStatus: "running", timeStartRace: START.toISOString(), totalLaps: 5,
    lapsCounter: 2, timeArrive: new Date(START.getTime() + 5 * 60 * 1000 - 2 * MIN_LAP_MS).toISOString(),
    lapsDetails: [
      { lap: 1, lapTime: "00:10", endTime: new Date(START.getTime() + MIN_LAP_MS).toISOString() },
      { lap: 2, lapTime: "00:11", endTime: new Date(START.getTime() + 2 * MIN_LAP_MS).toISOString() },
    ] as any, ...over });

const mount = (initial: RiderProps[]) =>
  renderHook(() => {
    const [riders, setRiders] = useState(initial);
    const [displayOrder, setDisplayOrder] = useState(initial.map((r) => r.id));
    const lap = useLapRecording({
      raceUuid: "race-1", persistKey: "race-1:heat:1", riders,
      updateRider: (r) => setRiders((prev) => prev.map((x) => (x.id === r.id ? r : x))),
      updateAllRiders: (all) => setRiders(all),
      circuitKm: null, isOnTrackAfterEnd: () => false, getCatColor: () => "#f00",
      displayOrder, setDisplayOrder, boardHoldMs: 2000,
    });
    const byId = (id: number) => riders.find((r) => r.id === id)!;
    return { lap, riders, byId, setRiders };
  });

/** What the live screen's status change does: write the rider, then log it. */
function markOut(result: any, id: number, status: "DNF" | "DSQ" | "DNS") {
  const before: RiderProps = result.current.byId(id);
  const after: RiderProps = { ...before, status, raceStatus: "finished" };
  act(() => {
    result.current.setRiders((prev: RiderProps[]) => prev.map((x) => (x.id === id ? after : x)));
  });
  act(() => { result.current.lap.logStatusChange(after, status, before); });
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START.getTime() + 5 * 60 * 1000));
  recordRaceEvent.mockReset().mockResolvedValue({});
  canForRace.mockReset().mockReturnValue(true);
});

describe("cancelling a status entry from the action log", () => {
  it.each(["DNF", "DSQ", "DNS"] as const)("cancel %s restores the previous status and keeps every lap", (status) => {
    const { result } = mount([rider(1)]);
    markOut(result, 1, status);
    expect(result.current.byId(1).status).toBe(status);

    const entry = result.current.lap.riderActions.find((a: any) => a.statusChange === status)!;
    act(() => { result.current.lap.cancelAction(entry.id); });

    const r = result.current.byId(1);
    expect(r.status).toBe("standing");
    expect(r.raceStatus).toBe("running");
    expect(r.lapsCounter).toBe(2);
    expect(r.lapsDetails).toHaveLength(2);
    expect(result.current.lap.riderActions.find((a: any) => a.id === entry.id)).toBeUndefined();
  });

  it("an older log entry without a snapshot clears to racing, still without touching laps", () => {
    const { result } = mount([rider(1)]);
    const after: RiderProps = { ...result.current.byId(1), status: "DNF", raceStatus: "finished" };
    act(() => { result.current.setRiders((prev: RiderProps[]) => prev.map((x) => (x.id === 1 ? after : x))); });
    act(() => { result.current.lap.logStatusChange(after, "DNF"); }); // no prevRider, like a pre-fix log
    const entry = result.current.lap.riderActions.find((a: any) => a.statusChange === "DNF")!;
    act(() => { result.current.lap.cancelAction(entry.id); });
    expect(result.current.byId(1)).toMatchObject({ status: "standing", raceStatus: "running", lapsCounter: 2 });
  });

  it("Revert Last Lap after a status change still reverts a lap, not the status snapshot", () => {
    const { result } = mount([rider(1)]);
    act(() => { result.current.lap.recordLap(result.current.byId(1)); });
    expect(result.current.byId(1).lapsCounter).toBe(3);
    markOut(result, 1, "DSQ");
    act(() => { result.current.lap.revertLap(result.current.byId(1)); });
    expect(result.current.byId(1).lapsCounter).toBe(2);
  });
});
