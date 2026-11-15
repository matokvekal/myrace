/**
 * Task 3 (2026-11-15): the action log is stored compacted, written at most once a second,
 * survives a reload with every entry and an exact latest-lap undo, handles a full storage,
 * and logs of finalized / deleted races are removed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";

const { toast } = vi.hoisted(() => ({ toast: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));
vi.mock("@/services/cloud/permissions", () => ({ canForRace: () => true }));
vi.mock("@/services/analytics/analyticsClient", () => ({ logAnalyticsEvent: vi.fn() }));
vi.mock("react-toastify", () => ({ toast }));

import { useLapRecording, type RiderAction } from "../useLapRecording";
import { compactActions, pruneWaveStorage, FULL_ENTRY_MS, LOG_SAVE_DELAY_MS } from "../actionLogStorage";
import { makeRider } from "@/test/factories";
import type { RiderProps } from "@/types/types";

const START = new Date("2026-06-01T10:00:00.000Z");
const KEY = "race-1:heat:1";
const LS = `commissaire.actionLog.${KEY}`;

const mount = (initial: RiderProps[]) =>
  renderHook(() => {
    const [riders, setRiders] = useState(initial);
    const [displayOrder, setDisplayOrder] = useState(initial.map((r) => r.id));
    const lap = useLapRecording({
      raceUuid: "race-1",
      persistKey: KEY,
      riders,
      updateRider: (r) => setRiders((prev) => prev.map((x) => (x.id === r.id ? r : x))),
      updateAllRiders: (all) => setRiders(all),
      circuitKm: null,
      isOnTrackAfterEnd: () => false,
      getCatColor: () => "#f00",
      displayOrder,
      setDisplayOrder,
      boardHoldMs: 2000,
    });
    return { lap, riders };
  });

const started = (n: number) =>
  Array.from({ length: n }, () => makeRider({ raceStatus: "running", timeStartRace: START.toISOString(), totalLaps: 20 }));

/** Every rider rides `laps` laps, 3 minutes apart (min-lap rule respected). */
function ride(h: ReturnType<typeof mount>, laps: number) {
  for (let l = 0; l < laps; l++) {
    act(() => { vi.advanceTimersByTime(3 * 60 * 1000); });
    for (const r of h.result.current.riders) act(() => { h.result.current.lap.recordLap(r); });
  }
}

let setItem: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(START.getTime() + 60 * 1000));
  toast.warn.mockClear();
  setItem = vi.spyOn(Storage.prototype, "setItem");
});
afterEach(() => {
  setItem.mockRestore();
  vi.useRealTimers();
});

describe("compactActions", () => {
  const rider = makeRider({ id: 1 });
  const lapEntry = (lap: number, ts: number, statusChange?: RiderAction["statusChange"]): RiderAction => ({
    id: `1-${lap}-${ts}`,
    rider: { ...rider, lapsCounter: lap, lapsDetails: Array.from({ length: lap }, (_, i) => ({ lap: i + 1, startTime: new Date(0), endTime: new Date(1), lapTime: "00:01:00", position: 1 })) },
    prevRider: { ...rider, lapsCounter: lap - 1 },
    timestamp: ts,
    source: "click",
    categoryColor: "#f00",
    statusChange,
  });

  it("keeps the snapshot of the newest entry, the newest lap and recent entries; trims older ones to their own lap", () => {
    const now = 10 * FULL_ENTRY_MS;
    const log = [lapEntry(3, now - 5 * FULL_ENTRY_MS, "DNF"), lapEntry(3, now - 6 * FULL_ENTRY_MS), lapEntry(2, now - 7 * FULL_ENTRY_MS), lapEntry(1, now - 8 * FULL_ENTRY_MS)];
    const c = compactActions(log, now);
    expect(c).toHaveLength(4); // every arrival kept
    expect(c[0]).toBe(log[0]); // newest entry of the rider (a status)
    expect(c[1]).toBe(log[1]); // newest LAP entry: the keypad / rider-menu undo target
    expect(c[2].prevRider).toBeUndefined();
    expect(c[2].rider.lapsDetails).toHaveLength(1);
    expect(c[2].rider.lapsDetails[0].lap).toBe(2);
    expect(Object.keys(c[2].rider)).not.toContain("comment"); // only what the Log shows
    expect(c[2].rider).toMatchObject({ id: 1, bibNumber: rider.bibNumber, firstName: rider.firstName, lapsCounter: 2 });
    expect(c[2]).toMatchObject({ id: log[2].id, timestamp: log[2].timestamp, source: "click", categoryColor: "#f00" });
    expect(compactActions(log, log[2].timestamp + 1000)[2]).toBe(log[2]); // young → untouched
  });
});

describe("action log storage in a long race (100 riders × 12 laps)", () => {
  it("writes at most once a second, stays small, and a reload restores every entry with an exact undo", () => {
    const h = mount(started(100));
    ride(h, 12);
    act(() => { vi.advanceTimersByTime(LOG_SAVE_DELAY_MS); });
    const logWrites = setItem.mock.calls.filter(([k]) => k === LS).length;
    // 1,200 laps, recorded in 12 bunches of 100 taps: one write per bunch (+ the trailing one).
    expect(logWrites).toBeLessThanOrEqual(13);

    const stored = localStorage.getItem(LS)!;
    const entries = JSON.parse(stored) as RiderAction[];
    expect(entries).toHaveLength(1200);
    const full = h.result.current.lap.riderActions;
    const fullSize = JSON.stringify(full).length;
    // Uncompacted this is laps² per rider; compacted it grows ~linearly.
    expect(stored.length).toBeLessThan(fullSize / 2.5);

    // Every entry keeps what the Log shows: rider, lap count, its own lap time.
    const byId = new Map(full.map((a) => [a.id, a]));
    for (const e of entries) {
      const f = byId.get(e.id)!;
      expect([e.rider.bibNumber, e.rider.lapsCounter, e.timestamp, e.source]).toEqual([f.rider.bibNumber, f.rider.lapsCounter, f.timestamp, f.source]);
      expect(e.rider.lapsDetails.at(-1)!.lapTime).toBe(f.rider.lapsDetails.at(-1)!.lapTime);
    }

    // Reload: the newest lap of a rider undoes to the EXACT pre-tap rider (BUGS.md #10).
    const riders = h.result.current.riders;
    h.unmount();
    const again = mount(riders);
    expect(again.result.current.lap.riderActions).toHaveLength(1200);
    const target = riders[7];
    const newest = again.result.current.lap.riderActions.find((a) => a.rider.id === target.id)!;
    act(() => { again.result.current.lap.cancelAction(newest.id); });
    const restored = again.result.current.riders.find((r) => r.id === target.id)!;
    expect(restored).toEqual(newest.prevRider);
    expect(restored.lapsCounter).toBe(11);
    expect(restored.lapsDetails).toHaveLength(11);
  });

  it("an entry is written when the screen unmounts (wave left / page closed) before the batch timer", () => {
    const h = mount(started(1));
    ride(h, 1);
    expect(localStorage.getItem(LS)).toBeNull();
    h.unmount();
    expect(JSON.parse(localStorage.getItem(LS)!)).toHaveLength(1);
  });
});

describe("full storage", () => {
  it("never blocks the lap: frees finished races' logs, and warns once if it still can't save", () => {
    const h = mount(started(2));
    setItem.mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    ride(h, 1);
    expect(h.result.current.riders.every((r) => r.lapsCounter === 1)).toBe(true);
    act(() => { vi.advanceTimersByTime(LOG_SAVE_DELAY_MS); });
    expect(toast.warn).toHaveBeenCalledWith(expect.stringContaining("storage is full"), { toastId: "action-log-storage-full" });
  });
});

describe("pruneWaveStorage", () => {
  it("removes only the per-wave Live keys of finalized / removed races", () => {
    setItem.mockRestore();
    localStorage.setItem("commissaire.actionLog.done:heat:1", "[]");
    localStorage.setItem("commissaire.finishRedo.done:heat:1", "[]");
    localStorage.setItem("commissaire.rapidEntry.gone:heat:2", "[]");
    localStorage.setItem("commissaire.actionLog.live:heat:1", "[]");
    localStorage.setItem("commissaire.actionLog.unknown:heat:1", "[]");
    localStorage.setItem("commissaire.jokers.done:heat:1", "[]");
    localStorage.setItem("resultsVisibleFields", "x");
    const state = { done: "finalized", gone: "gone", live: "active" } as const;
    const n = pruneWaveStorage((u) => (state as Record<string, "finalized" | "gone" | "active">)[u] ?? "unknown");
    expect(n).toBe(3);
    expect(Object.keys(localStorage).sort()).toEqual([
      "commissaire.actionLog.live:heat:1",
      "commissaire.actionLog.unknown:heat:1",
      "commissaire.jokers.done:heat:1",
      "resultsVisibleFields",
    ]);
  });
});
