/**
 * Two judges on one shared race: another device's lap lands in the store between this
 * screen's render and the tap. The tap must build on the store, so both laps survive.
 */
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

import { useLapRecording } from "../useLapRecording";
import useCategoryStore from "@/stores/categoryStore";
import type { CategoryProps } from "@/types/types";
import { makeRider } from "@/test/factories";
import type { RiderProps } from "@/types/types";

const START = new Date("2026-06-01T10:00:00.000Z");
const started = (over: Partial<RiderProps>) =>
  makeRider({ raceStatus: "running", timeStartRace: START.toISOString(), totalLaps: 3, category: "M", ...over });

/** A remote lap, as the live sync applies it to the store. */
const remoteLap = (r: RiderProps, at: Date): RiderProps => ({
  ...r,
  lapsCounter: r.lapsCounter + 1,
  timeArrive: at.toISOString(),
  lapsDetails: [...(r.lapsDetails ?? []), { lap: r.lapsCounter + 1, startTime: START, endTime: at, lapTime: "00:04:00", position: 1 }],
});

/**
 * `riders` is the RENDER (frozen until re-render); `store.current` is the live store,
 * which a remote lap updates without a re-render — the window the bug lived in.
 */
const mount = (initial: RiderProps[]) => {
  const store = { current: initial };
  const writes: RiderProps[][] = [];
  const hook = renderHook(() => {
    const [riders] = useState(initial);
    const [displayOrder, setDisplayOrder] = useState(initial.map((r) => r.id));
    return useLapRecording({
      raceUuid: "race-1",
      persistKey: null,
      riders,
      latestRiders: () => store.current,
      updateRider: (r) => { store.current = store.current.map((x) => (x.id === r.id ? r : x)); },
      updateAllRiders: (all) => { writes.push(all); store.current = store.current.map((x) => all.find((a) => a.id === x.id) ?? x); },
      circuitKm: null,
      isOnTrackAfterEnd: () => false,
      getCatColor: () => "#f00",
      displayOrder,
      setDisplayOrder,
      boardHoldMs: 2000,
    });
  });
  return { hook, store, writes };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START.getTime() + 5 * 60 * 1000));
  Object.values(toast).forEach((f) => f.mockClear());
  recordRaceEvent.mockReset().mockResolvedValue({});
  canForRace.mockReset().mockReturnValue(true);
});

describe("concurrent taps from two devices", () => {
  it("remote lap for rider B arrives between render and a tap on A → both laps kept", () => {
    const a = started({ id: 1, bibNumber: 1 });
    const b = started({ id: 2, bibNumber: 2 });
    const { hook, store, writes } = mount([a, b]);

    store.current = store.current.map((r) => (r.id === 2 ? remoteLap(r, new Date(Date.now() - 1000)) : r));
    act(() => hook.result.current.recordLap(a)); // `a` is the stale card from the render

    const byId = (id: number) => store.current.find((r) => r.id === id)!;
    expect(byId(1).lapsCounter).toBe(1);
    expect(byId(2).lapsCounter).toBe(1); // the remote lap was not overwritten
    expect(writes.at(-1)!.find((r) => r.id === 2)!.lapsCounter).toBe(1);
  });

  it("both judges tap the same rider: the stale card does not make a second lap", () => {
    const a = started({ id: 1, bibNumber: 1 });
    const { hook, store } = mount([a]);

    store.current = [remoteLap(a, new Date(Date.now() - 1000))];
    act(() => hook.result.current.recordLap(a));

    expect(store.current[0].lapsCounter).toBe(1);
    expect(toast.info).toHaveBeenCalled(); // minimum-lap guard, using the store's arrival
  });

  it("a second lap on a rider whose first lap came from another device continues from it", () => {
    const a = started({ id: 1, bibNumber: 1 });
    const { hook, store } = mount([a]);

    store.current = [remoteLap(a, new Date(Date.now() - 4 * 60 * 1000))];
    act(() => hook.result.current.recordLap(a));

    expect(store.current[0].lapsCounter).toBe(2);
    expect(store.current[0].lapsDetails).toHaveLength(2);
  });

  it("undo of a local lap keeps a remote lap that arrived after it", () => {
    const a = started({ id: 1, bibNumber: 1 });
    const b = started({ id: 2, bibNumber: 2 });
    const { hook, store } = mount([a, b]);

    act(() => hook.result.current.recordLap(a));
    store.current = store.current.map((r) => (r.id === 2 ? remoteLap(r, new Date()) : r));
    act(() => vi.advanceTimersByTime(100));
    const last = hook.result.current.riderActions[0];
    act(() => { hook.result.current.cancelAction(last.id); });

    expect(store.current.find((r) => r.id === 1)!.lapsCounter).toBe(0);
    expect(store.current.find((r) => r.id === 2)!.lapsCounter).toBe(1);
  });

  it("manual finish keeps a remote lap of another rider", () => {
    const a = started({ id: 1, bibNumber: 1 });
    const b = started({ id: 2, bibNumber: 2 });
    const { hook, store } = mount([a, b]);

    store.current = store.current.map((r) => (r.id === 2 ? remoteLap(r, new Date()) : r));
    act(() => { hook.result.current.finishRider(a); });

    expect(store.current.find((r) => r.id === 1)!.raceStatus).toBe("finished");
    expect(store.current.find((r) => r.id === 2)!.lapsCounter).toBe(1);
  });

  it("lap 1 runs from the category's official start, not the starter's HH:MM:SS clock", () => {
    // The starter's phone was 15 s fast: its clock string says 10:00:15, the server-aligned start is 10:00:00.
    const official = START.getTime();
    const prev = useCategoryStore.getState().categories;
    useCategoryStore.setState({ categories: [{ name: "M", subCategory: null, raceUuid: "race-1", startedAt: official } as unknown as CategoryProps] });
    try {
      const a = started({ id: 1, bibNumber: 1, timeStartRace: "23:59:59" });
      const { hook, store } = mount([a]);
      act(() => hook.result.current.recordLap(a)); // system time = START + 5 min
      expect(store.current[0].elapsedLastLap).toBe("05:00");
      expect(new Date(store.current[0].lapsDetails![0].startTime as Date).getTime()).toBe(official);
    } finally {
      useCategoryStore.setState({ categories: prev });
    }
  });
});
