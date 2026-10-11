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

const START = new Date("2026-06-01T10:00:00.000Z");

/** Mount the hook with a tiny in-memory "store" so updates feed back in, like the real page. */
const mount = (initial: RiderProps[], opts: { persistKey?: string | null; holdMs?: number; isOnTrackAfterEnd?: boolean } = {}) =>
  renderHook(() => {
    const [riders, setRiders] = useState(initial);
    const [displayOrder, setDisplayOrder] = useState(initial.map((r) => r.id));
    const lap = useLapRecording({
      raceUuid: "race-1",
      persistKey: opts.persistKey === undefined ? "race-1:heat:1" : opts.persistKey,
      riders,
      updateRider: (r) => setRiders((prev) => prev.map((x) => (x.id === r.id ? r : x))),
      updateAllRiders: (all) => setRiders(all),
      circuitKm: null,
      isOnTrackAfterEnd: () => opts.isOnTrackAfterEnd ?? false,
      getCatColor: () => "#f00",
      displayOrder,
      setDisplayOrder,
      boardHoldMs: opts.holdMs ?? 2000,
    });
    return { lap, riders, displayOrder };
  });

const startedRider = (over: Partial<RiderProps> = {}) =>
  makeRider({ raceStatus: "running", timeStartRace: START.toISOString(), totalLaps: 3, ...over });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START.getTime() + 5 * 60 * 1000)); // 5 min into the race
  Object.values(toast).forEach((f) => f.mockClear());
  recordRaceEvent.mockReset().mockResolvedValue({});
  canForRace.mockReset().mockReturnValue(true);
});

describe("useLapRecording: recording laps", () => {
  it("records a lap: counter, lap detail, timing, event log entry", () => {
    const r = startedRider();
    const { result } = mount([r]);
    act(() => result.current.lap.recordLap(r));

    const updated = result.current.riders[0];
    expect(updated.lapsCounter).toBe(1);
    expect(updated.raceStatus).toBe("running");
    expect(updated.lapsDetails).toHaveLength(1);
    expect(updated.lapsDetails[0]).toMatchObject({ lap: 1 });
    expect(updated.timeArrive).toBe(new Date().toISOString());
    expect(updated.elapsedTimeFromStart).toBeTruthy();
    expect(recordRaceEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "LAP_MARKED", bibNumber: r.bibNumber, lapNumber: 1 })
    );
    expect(result.current.lap.riderActions).toHaveLength(1);
  });

  it("marks the rider finished on their last lap and refuses further laps", () => {
    const r = startedRider({ totalLaps: 2, lapsCounter: 1, timeArrive: new Date(Date.now() - 2 * MIN_LAP_MS).toISOString() });
    const { result } = mount([r]);
    act(() => result.current.lap.recordLap(r));
    expect(result.current.riders[0]).toMatchObject({ lapsCounter: 2, raceStatus: "finished" });

    recordRaceEvent.mockClear();
    act(() => result.current.lap.recordLap(result.current.riders[0]));
    expect(result.current.riders[0].lapsCounter).toBe(2);
    expect(recordRaceEvent).not.toHaveBeenCalled();
  });

  it("finishes a rider on the next crossing when their category has already ended", () => {
    const r = startedRider({ totalLaps: 5 });
    const { result } = mount([r], { isOnTrackAfterEnd: true });
    act(() => result.current.lap.recordLap(r));
    expect(result.current.riders[0].raceStatus).toBe("finished");
  });

  it("rejects a second lap inside the minimum lap time and tells the user", () => {
    const r = startedRider({ lapsCounter: 1, timeArrive: new Date(Date.now() - 20_000).toISOString() });
    const { result } = mount([r]);
    act(() => result.current.lap.recordLap(r));
    expect(result.current.riders[0].lapsCounter).toBe(1);
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/Wait \d+s/));
  });

  it("swallows an accidental double tap on the same rider (<500ms)", () => {
    const r = startedRider();
    const { result } = mount([r]);
    act(() => result.current.lap.recordLap(r));
    act(() => {
      vi.advanceTimersByTime(200);
      result.current.lap.recordLap(result.current.riders[0]);
    });
    expect(result.current.riders[0].lapsCounter).toBe(1);
  });

  it("records nothing, and warns, without MARK_LAP permission", () => {
    canForRace.mockReturnValue(false);
    const r = startedRider();
    const { result } = mount([r]);
    act(() => result.current.lap.recordLap(r));
    expect(result.current.riders[0].lapsCounter).toBe(0);
    expect(toast.warn).toHaveBeenCalled();
    expect(recordRaceEvent).not.toHaveBeenCalled();
  });

  it("assigns category positions in finishing order", () => {
    const a = startedRider({ category: "Elite", bibNumber: 1 });
    const b = startedRider({ category: "Elite", bibNumber: 2 });
    const { result } = mount([a, b]);
    act(() => result.current.lap.recordLap(a));
    act(() => {
      vi.advanceTimersByTime(1000);
      result.current.lap.recordLap(result.current.riders.find((r) => r.id === b.id)!);
    });
    const byBib = Object.fromEntries(result.current.riders.map((r) => [r.bibNumber, r.position_category]));
    expect(byBib).toEqual({ 1: 1, 2: 2 });
  });

  it("a backdated lap (Joker resolution) keeps its original time", () => {
    const r = startedRider();
    const { result } = mount([r]);
    const earlier = new Date(Date.now() - 30_000);
    act(() => result.current.lap.recordLap(r, "click", earlier));
    expect(result.current.riders[0].timeArrive).toBe(earlier.toISOString());
    expect(result.current.riders[0].lapsCounter).toBe(1);
  });
});

describe("useLapRecording: undo", () => {
  it("revertLap restores the exact pre-tap rider", () => {
    const r = startedRider();
    const { result } = mount([r]);
    act(() => result.current.lap.recordLap(r));
    expect(result.current.riders[0].lapsCounter).toBe(1);

    let ok = false;
    act(() => {
      ok = result.current.lap.revertLap(result.current.riders[0]);
    });
    expect(ok).toBe(true);
    expect(result.current.riders[0]).toMatchObject({ lapsCounter: 0, timeArrive: null, lapsDetails: [] });
    expect(result.current.lap.riderActions).toHaveLength(0);
    expect(recordRaceEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "UNDO" }));
  });

  it("revertLap on a rider with no laps does nothing", () => {
    const r = startedRider();
    const { result } = mount([r]);
    let ok = true;
    act(() => {
      ok = result.current.lap.revertLap(r);
    });
    expect(ok).toBe(false);
  });

  it("revertLap needs UNDO_EVENT permission", () => {
    const r = startedRider({ lapsCounter: 1, lapsDetails: [{ lap: 1, startTime: START, endTime: START, lapTime: "1" }] });
    const { result } = mount([r]);
    canForRace.mockReturnValue(false);
    let ok = true;
    act(() => {
      ok = result.current.lap.revertLap(r);
    });
    expect(ok).toBe(false);
    expect(result.current.riders[0].lapsCounter).toBe(1);
  });
});

describe("useLapRecording: board hold (tapped card drops to the end)", () => {
  it("keeps the card in place until taps stop, then drops it to the end", () => {
    const [a, b, c] = [startedRider(), startedRider(), startedRider()];
    const { result } = mount([a, b, c], { holdMs: 2000 });
    act(() => result.current.lap.recordLap(a));
    expect(result.current.displayOrder).toEqual([a.id, b.id, c.id]); // not moved yet
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(result.current.displayOrder).toEqual([b.id, c.id, a.id]);
  });

  it("a finished rider leaves the queue instead of going to the end", () => {
    const a = startedRider({ totalLaps: 1 });
    const b = startedRider();
    const { result } = mount([a, b]);
    act(() => result.current.lap.recordLap(a));
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(result.current.displayOrder).toEqual([b.id]);
  });

  it("undo before the hold expires cancels the move", () => {
    const [a, b] = [startedRider(), startedRider()];
    const { result } = mount([a, b]);
    act(() => result.current.lap.recordLap(a));
    act(() => {
      result.current.lap.revertLap(result.current.riders[0]);
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.displayOrder).toEqual([a.id, b.id]);
  });
});

describe("useLapRecording: persisted action log", () => {
  it("persists arrivals per wave and restores them after a reload", () => {
    const r = startedRider();
    const first = mount([r], { persistKey: "race-1:heat:1" });
    act(() => first.result.current.lap.recordLap(r));
    expect(localStorage.getItem("commissaire.actionLog.race-1:heat:1")).toContain(String(r.id));
    first.unmount();

    const reloaded = mount([r], { persistKey: "race-1:heat:1" });
    expect(reloaded.result.current.lap.riderActions).toHaveLength(1);
  });

  it("does not leak one wave's log into another", () => {
    const r = startedRider();
    const w1 = mount([r], { persistKey: "race-1:heat:1" });
    act(() => w1.result.current.lap.recordLap(r));
    w1.unmount();
    const w2 = mount([r], { persistKey: "race-1:heat:2" });
    expect(w2.result.current.lap.riderActions).toHaveLength(0);
  });

  it("survives corrupt stored data", () => {
    localStorage.setItem("commissaire.actionLog.race-1:heat:1", "{not json");
    const { result } = mount([startedRider()]);
    expect(result.current.lap.riderActions).toEqual([]);
  });

  it("does not persist when persistence is disabled (null key)", () => {
    const r = startedRider();
    const { result } = mount([r], { persistKey: null });
    act(() => result.current.lap.recordLap(r));
    expect(localStorage.length).toBe(0);
  });
});
