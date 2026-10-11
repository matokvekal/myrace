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
import { computeGroupSignals } from "@/utils/linkedGroups";
import { makeRider } from "@/test/factories";
import type { CategoryProps, RiderProps } from "@/types/types";

const START = new Date("2026-06-01T10:00:00.000Z");
const rider = (id: number, category: string, over: Partial<RiderProps> = {}) =>
  makeRider({ id, bibNumber: id, category, raceStatus: "running", timeStartRace: START.toISOString(), totalLaps: 5,
    lapsCounter: 2, timeArrive: new Date(START.getTime() + 5 * 60 * 1000 - 2 * MIN_LAP_MS).toISOString(),
    lapsDetails: [{ lap: 1, lapTime: "00:10" }, { lap: 2, lapTime: "00:11" }] as any, ...over });

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
    return { lap, riders, byId };
  });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START.getTime() + 5 * 60 * 1000));
  recordRaceEvent.mockReset().mockResolvedValue({});
  canForRace.mockReset().mockReturnValue(true);
});

describe("manual Finish Race", () => {
  it("finishes only that rider, stamps the time, keeps laps and history", () => {
    const { result } = mount([rider(1, "Man Pro"), rider(2, "Man Pro")]);
    const before = result.current.byId(1);
    act(() => { result.current.lap.finishRider(before); });
    const r = result.current.byId(1);
    expect(r.raceStatus).toBe("finished");
    expect(r.timeArrive).toBe(new Date().toISOString());
    expect(r.elapsedTimeFromStart).toBeTruthy();
    expect(r.lapsCounter).toBe(2);
    expect(r.lapsDetails).toEqual(before.lapsDetails);
    expect(result.current.byId(2).raceStatus).toBe("running");
    expect(recordRaceEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "RIDER_EDITED", bibNumber: 1 }));
  });

  it("never raises the category-wide finish flag", () => {
    const cat = { id: 1, raceUuid: "race-1", name: "Man Pro", subCategory: null, laps: 5, lapsCounter: 0, riders: 0,
      startTime: null, isConnected: false, color: null, heat: 1 } as CategoryProps;
    const { result } = mount([rider(1, "Man Pro"), rider(2, "Man Pro")]);
    act(() => { result.current.lap.finishRider(result.current.byId(1)); });
    expect(computeGroupSignals([cat], result.current.riders).finish.size).toBe(0);
  });

  it("undo restores the exact pre-finish rider; redo (finish again) works", () => {
    const { result } = mount([rider(1, "Man Pro")]);
    const before = result.current.byId(1);
    act(() => { result.current.lap.finishRider(before); });
    const entry = result.current.lap.riderActions[0];
    expect(entry.statusChange).toBe("FINISH");

    act(() => { result.current.lap.cancelAction(entry.id); });
    expect(result.current.byId(1)).toMatchObject({
      raceStatus: "running", lapsCounter: 2, timeArrive: before.timeArrive,
    });
    expect(result.current.byId(1).lapsDetails).toEqual(before.lapsDetails);
    expect(result.current.lap.riderActions).toHaveLength(0);

    act(() => { result.current.lap.finishRider(result.current.byId(1)); });
    expect(result.current.byId(1).raceStatus).toBe("finished");
  });

  it("refuses finished/out riders and missing permission", () => {
    const { result } = mount([rider(1, "Man Pro", { status: "DNF" }), rider(2, "Man Pro")]);
    let ok = true;
    act(() => { ok = result.current.lap.finishRider(result.current.byId(1)); });
    expect(ok).toBe(false);
    canForRace.mockReturnValue(false);
    act(() => { ok = result.current.lap.finishRider(result.current.byId(2)); });
    expect(ok).toBe(false);
    expect(result.current.byId(2).raceStatus).toBe("running");
  });

  it("persists the log entry so a reload still knows about it", () => {
    const { result } = mount([rider(1, "Man Pro")]);
    act(() => { result.current.lap.finishRider(result.current.byId(1)); });
    const stored = JSON.parse(localStorage.getItem("commissaire.actionLog.race-1:heat:1") ?? "[]");
    expect(stored[0].statusChange).toBe("FINISH");
  });
});
