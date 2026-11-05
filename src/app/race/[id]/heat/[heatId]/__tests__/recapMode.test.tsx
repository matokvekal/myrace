import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";

const { toast } = vi.hoisted(() => ({ toast: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn() } }));
vi.mock("react-toastify", () => ({ toast }));
vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));
vi.mock("@/services/cloud/permissions", () => ({ canForRace: () => true }));
vi.mock("@/services/analytics/analyticsClient", () => ({ logAnalyticsEvent: vi.fn() }));

import { useRecapMode, RECAP_IDLE_MS, RECAP_MIN_LAP_SECONDS } from "../useRecapMode";
import { useLapRecording } from "../useLapRecording";
import RacingRider from "../../../categories/racingRider/RacingRider";
import useRaceStore from "@/stores/racesStore";
import { makeRider } from "@/test/factories";
import type { RiderProps } from "@/types/types";

/**
 * RECAP: a temporary timing mode — normal recording with a 6-minute duplicate
 * check, ends after 30 s idle or on Exit; double-tap opens history, never a lap.
 */
const START = new Date("2026-06-01T10:00:00.000Z");
const startedRider = (over: Partial<RiderProps> = {}) =>
  makeRider({ raceStatus: "running", timeStartRace: START.toISOString(), totalLaps: 9, ...over });

const mount = (initial: RiderProps[], minLapMsOverride?: number) =>
  renderHook(() => {
    const [riders, setRiders] = useState(initial);
    const [displayOrder, setDisplayOrder] = useState(initial.map((r) => r.id));
    const lap = useLapRecording({
      raceUuid: "race-1",
      persistKey: null,
      riders,
      updateRider: (r) => setRiders((prev) => prev.map((x) => (x.id === r.id ? r : x))),
      updateAllRiders: (all) => setRiders(all),
      circuitKm: null,
      isOnTrackAfterEnd: () => false,
      getCatColor: () => "#f00",
      displayOrder,
      setDisplayOrder,
      boardHoldMs: 2000,
      minLapMsOverride,
    });
    return { lap, riders };
  });

describe("useRecapMode", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is active until 30 s pass without interaction; each interaction restarts the countdown; Exit ends it at once", () => {
    const { result } = renderHook(() => useRecapMode());
    act(() => result.current.enter());
    expect(result.current.active).toBe(true);
    act(() => vi.advanceTimersByTime(RECAP_IDLE_MS - 1_000));
    act(() => result.current.touch());
    act(() => vi.advanceTimersByTime(RECAP_IDLE_MS - 1_000));
    expect(result.current.active).toBe(true);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.active).toBe(false);
    act(() => result.current.enter());
    act(() => result.current.exit());
    expect(result.current.active).toBe(false);
  });
});

describe("recording in RECAP (6-minute duplicate check)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(START.getTime() + 60 * 60_000));
    Object.values(toast).forEach((f) => f.mockClear());
    useRaceStore.setState({ races: [{ uuid: "race-1", minLapSeconds: 180 } as never] });
  });
  afterEach(() => {
    vi.useRealTimers();
    useRaceStore.setState({ races: [] });
  });
  const RECAP = RECAP_MIN_LAP_SECONDS * 1000;

  it("records a passage normally when the last one is older than 6 minutes", () => {
    const r = startedRider({ lapsCounter: 1, timeArrive: new Date(Date.now() - 7 * 60_000).toISOString() });
    const { result } = mount([r], RECAP);
    act(() => result.current.lap.recordLap(r));
    expect(result.current.riders[0].lapsCounter).toBe(2);
  });

  it("rejects a passage inside 6 minutes: no new lap, the existing passage untouched", () => {
    const last = new Date(Date.now() - 5 * 60_000).toISOString();
    const r = startedRider({ lapsCounter: 1, timeArrive: last, lapsDetails: [{ lap: 1, startTime: START, endTime: new Date(last), lapTime: "55:00" }] });
    const { result } = mount([r], RECAP);
    act(() => result.current.lap.recordLap(r));
    expect(result.current.riders[0]).toMatchObject({ lapsCounter: 1, timeArrive: last });
    expect(result.current.riders[0].lapsDetails).toHaveLength(1);
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/Wait 60s/));
  });

  it("without RECAP the race's own minimum (3 min) applies: the same passage at 5 minutes is recorded", () => {
    const r = startedRider({ lapsCounter: 1, timeArrive: new Date(Date.now() - 5 * 60_000).toISOString() });
    const { result } = mount([r]);
    act(() => result.current.lap.recordLap(r));
    expect(result.current.riders[0].lapsCounter).toBe(2);
  });
});

describe("rider card taps", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a double-tap opens the rider's history and records nothing; a single tap records at the tap time", () => {
    const onClick = vi.fn();
    const onDoubleClick = vi.fn();
    render(<RacingRider rider={startedRider({ bibNumber: 7 })} color="#f00" onClick={onClick} onDoubleClick={onDoubleClick} />);
    const card = screen.getByTestId("racing-rider-7");

    fireEvent.click(card);
    act(() => vi.advanceTimersByTime(120));
    fireEvent.click(card);
    act(() => vi.advanceTimersByTime(500));
    expect(onDoubleClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();

    const tappedAt = Date.now();
    fireEvent.click(card);
    act(() => vi.advanceTimersByTime(300));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect((onClick.mock.calls[0][0] as Date).getTime()).toBe(tappedAt); // the tap, not the end of the 300 ms wait
  });
});
