import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";

/**
 * Shared race: the live screen sends the same AddLap for a tap, a voice
 * detection and a resolved Joker (with the Joker's captured time); undo and
 * revert target exactly their lap; a refused lap changes nothing.
 */
const { liveDispatch, liveAllows, recordRaceEvent, canForRace } = vi.hoisted(() => ({
  liveDispatch: vi.fn().mockResolvedValue("id"),
  liveAllows: vi.fn().mockReturnValue(true),
  recordRaceEvent: vi.fn().mockResolvedValue({}),
  canForRace: vi.fn().mockReturnValue(true),
}));
let idSeq = 0;
vi.mock("@/services/live/liveBridge", () => ({
  isLiveRace: () => true,
  liveAllows,
  liveDispatch,
  newActionId: () => `act-${++idSeq}`,
  liveBridge: () => null,
  isApplyingRemote: () => false,
}));
vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent }));
vi.mock("@/services/cloud/permissions", () => ({ canForRace }));
vi.mock("@/services/analytics/analyticsClient", () => ({ logAnalyticsEvent: vi.fn() }));
vi.mock("react-toastify", () => ({ toast: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import { useLapRecording } from "../useLapRecording";
import { makeRider } from "@/test/factories";
import type { RiderProps } from "@/types/types";

const START = new Date("2026-06-01T10:00:00.000Z");
const rider = (over: Partial<RiderProps> = {}) =>
  makeRider({ id: 1, uuid: "11111111-1111-4111-8111-111111111111", bibNumber: 7, category: "Elite", raceStatus: "running",
    timeStartRace: START.toISOString(), totalLaps: 5, lapsCounter: 0, timeArrive: null, lapsDetails: [], ...over });

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
    return { lap, byId: (id: number) => riders.find((r) => r.id === id)! };
  });

beforeEach(() => {
  // restoreMocks (vitest config) resets implementations before each test: re-arm them.
  liveDispatch.mockReset().mockResolvedValue("id");
  liveAllows.mockReset().mockReturnValue(true);
  canForRace.mockReset().mockReturnValue(true);
  recordRaceEvent.mockReset().mockResolvedValue({});
  idSeq = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START.getTime() + 10 * 60_000));
});

describe("shared race: live laps", () => {
  it("a voice-detected lap sends the same AddLap as a tap, with the lap's id on the lap", () => {
    const { result } = mount([rider()]);
    act(() => result.current.lap.recordLap(result.current.byId(1), "voice"));
    expect(liveDispatch).toHaveBeenCalledWith("race-1", "AddLap", { riderUuid: "11111111-1111-4111-8111-111111111111" },
      { actionId: "act-1", atMs: START.getTime() + 10 * 60_000 });
    expect(result.current.byId(1).lapsDetails.at(-1)?.actionId).toBe("act-1");
  });

  it("a resolved Joker sends the lap at the time it was captured, not when it was resolved", () => {
    const { result } = mount([rider()]);
    const captured = new Date(START.getTime() + 8 * 60_000);
    act(() => result.current.lap.recordLap(result.current.byId(1), "click", captured));
    expect(liveDispatch.mock.calls[0][3]).toMatchObject({ atMs: captured.getTime() });
  });

  it("a lap the member may not record changes nothing", () => {
    liveAllows.mockReturnValue(false);
    const { result } = mount([rider()]);
    act(() => result.current.lap.recordLap(result.current.byId(1)));
    expect(liveDispatch).not.toHaveBeenCalled();
    expect(result.current.byId(1).lapsCounter).toBe(0);
  });

  it("revert last lap undoes exactly that lap's AddLap", () => {
    const { result } = mount([rider()]);
    act(() => result.current.lap.recordLap(result.current.byId(1)));
    act(() => { result.current.lap.revertLap(result.current.byId(1)); });
    expect(liveDispatch).toHaveBeenLastCalledWith("race-1", "Undo", { targetActionId: "act-1" });
    expect(result.current.byId(1).lapsCounter).toBe(0);
  });

  it("cancelling a lap from the action log undoes that entry's AddLap", () => {
    const { result } = mount([rider()]);
    act(() => result.current.lap.recordLap(result.current.byId(1)));
    const entry = result.current.lap.riderActions[0];
    act(() => { result.current.lap.cancelAction(entry.id); });
    expect(liveDispatch).toHaveBeenLastCalledWith("race-1", "Undo", { targetActionId: entry.liveActionId });
  });

  it("finish sends RiderFinished; cancelling it undoes that finish", () => {
    const { result } = mount([rider({ lapsCounter: 1, timeArrive: START.toISOString() })]);
    act(() => { result.current.lap.finishRider(result.current.byId(1)); });
    const finishCall = liveDispatch.mock.calls.find((c) => c[1] === "RiderFinished")!;
    const entry = result.current.lap.riderActions.find((a) => a.statusChange === "FINISH")!;
    expect(entry.liveActionId).toBe(finishCall[3].actionId);
    act(() => { result.current.lap.cancelAction(entry.id); });
    expect(liveDispatch).toHaveBeenLastCalledWith("race-1", "Undo", { targetActionId: entry.liveActionId });
  });
});
