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
import { computeGroupSignals, categoryGroupKey, riderGroupKey } from "@/utils/linkedGroups";
import { riderInCategory } from "../../../schedule/Schedule";
import { makeRider } from "@/test/factories";
import type { CategoryProps, RiderProps } from "@/types/types";

const START = new Date("2026-06-01T10:00:00.000Z");
const cat = (name: string, over: Partial<CategoryProps> = {}) =>
  ({ id: 1, raceUuid: "race-1", name, subCategory: null, laps: 5, lapsCounter: 0, riders: 0, startTime: null,
     isConnected: false, color: null, heat: 1, status: "running", ...over }) as CategoryProps;
const rider = (id: number, category: string, over: Partial<RiderProps> = {}) =>
  makeRider({ id, bibNumber: id, category, raceStatus: "running", timeStartRace: START.toISOString(), totalLaps: 5,
    timeArrive: new Date(START.getTime() + 5 * 60 * 1000 - 2 * MIN_LAP_MS).toISOString(), ...over });

const mount = (cats: CategoryProps[], initial: RiderProps[]) =>
  renderHook(() => {
    const [riders, setRiders] = useState(initial);
    const [displayOrder, setDisplayOrder] = useState(initial.map((r) => r.id));
    const signals = computeGroupSignals(cats, riders);
    const isOnTrackAfterEnd = (r: RiderProps) => {
      const c = cats.find((x) => riderInCategory(r, x));
      return !!c && r.raceStatus !== "finished" && signals.finish.has(riderGroupKey(c, r));
    };
    const lap = useLapRecording({
      raceUuid: "race-1", persistKey: "race-1:heat:1", riders,
      updateRider: (r) => setRiders((prev) => prev.map((x) => (x.id === r.id ? r : x))),
      updateAllRiders: (all) => setRiders(all),
      circuitKm: null, isOnTrackAfterEnd, getCatColor: () => "#f00",
      displayOrder, setDisplayOrder, boardHoldMs: 2000,
    });
    return { lap, riders, signals };
  });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START.getTime() + 5 * 60 * 1000));
  recordRaceEvent.mockReset().mockResolvedValue({});
  canForRace.mockReset().mockReturnValue(true);
});

describe("group-wide bell and finish", () => {
  const masters = [cat("Man Masters 30-39", { linkGroup: "masters" }), cat("Women Masters 40-49", { linkGroup: "masters" })];
  const pro = cat("Man Pro");

  it("category-wide bell (1 lap left) reaches the whole configured group, not other categories in the wave", () => {
    const { result } = mount([...masters, pro], [
      rider(1, "Man Masters 30-39", { lapsCounter: 4 }), // 1 to go
      rider(2, "Women Masters 40-49", { lapsCounter: 1 }),
      rider(3, "Man Pro", { lapsCounter: 4 }),
    ]);
    expect(result.current.signals.bell.has("g:masters|laps:5")).toBe(true);
    expect(result.current.signals.bell.has(riderGroupKey(pro, { totalLaps: 5 }))).toBe(true); // Pro has its own leader at 1 to go
    expect(result.current.signals.bell.has(riderGroupKey(masters[0], { totalLaps: 5 }))).toBe(true);
    expect(result.current.signals.finish.size).toBe(0);
  });

  it("a Finish Group mixing distances: ordinary taps only add laps after the shorter race finished", () => {
    const men = cat("Men Level 2", { linkGroup: "1", laps: 6 });
    const women = cat("Women Level 2", { linkGroup: "1", laps: 2 });
    const { result } = mount([men, women], [
      rider(1, "Women Level 2", { totalLaps: 2, lapsCounter: 1 }),
      rider(2, "Men Level 2", { totalLaps: 6, lapsCounter: 1 }),
    ]);
    act(() => result.current.lap.recordLap(result.current.riders[0])); // women's leader finishes 2/2
    expect(result.current.riders[0].raceStatus).toBe("finished");
    vi.advanceTimersByTime(MIN_LAP_MS + 1000);
    act(() => result.current.lap.recordLap(result.current.riders[1])); // man: 2/6 — 4 laps left
    expect(result.current.riders[1]).toMatchObject({ lapsCounter: 2, raceStatus: "running" });
    expect(result.current.signals.finish.has(riderGroupKey(men, { totalLaps: 6 }))).toBe(false);
  });

  it("leader finishing flags the group; followers finish on their NEXT crossing keeping their own laps", () => {
    const { result } = mount([...masters, pro], [
      rider(1, "Man Masters 30-39", { lapsCounter: 4 }),
      rider(2, "Women Masters 40-49", { lapsCounter: 1 }),
      rider(3, "Man Pro", { lapsCounter: 1 }),
    ]);
    act(() => result.current.lap.recordLap(result.current.riders[0]));
    expect(result.current.riders[0].raceStatus).toBe("finished");
    expect(result.current.signals.finish.has("g:masters|laps:5")).toBe(true);

    // Follower is flagged but NOT yet finished.
    expect(result.current.riders[1].raceStatus).toBe("running");
    act(() => result.current.lap.recordLap(result.current.riders[1]));
    const f = result.current.riders[1];
    expect(f).toMatchObject({ raceStatus: "finished", lapsCounter: 2 });
    expect(f.lapsDetails).toHaveLength(1);
    expect(f.timeArrive).toBeTruthy();

    // Independent group is untouched.
    act(() => result.current.lap.recordLap(result.current.riders[2]));
    expect(result.current.riders[2]).toMatchObject({ raceStatus: "running", lapsCounter: 2 });
  });

  it("undo of the leader's finish restores the whole group; redo reapplies it", () => {
    const { result } = mount(masters, [
      rider(1, "Man Masters 30-39", { lapsCounter: 4 }),
      rider(2, "Women Masters 40-49", { lapsCounter: 1 }),
    ]);
    const before = result.current.riders[0];
    act(() => result.current.lap.recordLap(before));
    expect(result.current.signals.finish.has("g:masters|laps:5")).toBe(true);

    act(() => { result.current.lap.revertLap(result.current.riders[0]); });
    expect(result.current.riders[0]).toMatchObject({ raceStatus: "running", lapsCounter: 4 });
    expect(result.current.signals.finish.size).toBe(0);
    expect(result.current.signals.bell.has("g:masters|laps:5")).toBe(true); // 1 to go: still bell

    act(() => { vi.advanceTimersByTime(1000); });
    act(() => result.current.lap.recordLap(result.current.riders[0])); // redo
    expect(result.current.riders[0].raceStatus).toBe("finished");
    expect(result.current.signals.finish.has("g:masters|laps:5")).toBe(true);
  });

  it("is derived from rider data, so it survives a reload (persisted riders round-trip)", () => {
    const riders = [
      rider(1, "Man Masters 30-39", { lapsCounter: 5, raceStatus: "finished" }),
      rider(2, "Women Masters 40-49", { lapsCounter: 1 }),
    ];
    const reloaded = JSON.parse(JSON.stringify(riders));
    const s = computeGroupSignals(masters, reloaded);
    expect(s.finish.has("g:masters|laps:5")).toBe(true);
    expect(s.bell.has("g:masters|laps:5")).toBe(false); // finish flag replaces the bell
  });

  it("an explicit linkGroup joins otherwise unrelated categories; keeps separate classification", () => {
    const a = cat("Man Elite", { linkGroup: "Open" });
    const b = cat("Man Pro", { linkGroup: " open " });
    expect(categoryGroupKey(a)).toBe(categoryGroupKey(b));
    const s = computeGroupSignals([a, b], [rider(1, "Man Elite", { lapsCounter: 5, raceStatus: "finished" })]);
    expect(s.finish.has(riderGroupKey(b, { totalLaps: 5 }))).toBe(true);
    // category identity (used for results/medals) is unchanged by grouping
    expect(riderInCategory(rider(2, "Man Pro"), b)).toBe(true);
    expect(riderInCategory(rider(2, "Man Pro"), a)).toBe(false);
  });
});
