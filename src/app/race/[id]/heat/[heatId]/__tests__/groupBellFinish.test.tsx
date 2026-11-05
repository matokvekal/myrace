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
import { computeGroupPhases, phaseOfRider } from "@/utils/linkedGroups";
import { riderInCategory } from "../../../schedule/Schedule";
import { makeRider } from "@/test/factories";
import type { CategoryProps, RiderProps } from "@/types/types";

/**
 * The bell / flag phases through the real lap recording (taps), as the live
 * screen wires them: the icon is what the official shows at the NEXT crossing,
 * and a FLAG rider's next crossing is their finish. Synthetic riders.
 */
const START = new Date("2026-06-01T10:00:00.000Z");
const LAP = 5 * 60 * 1000;
const cat = (name: string, over: Partial<CategoryProps> = {}) =>
  ({ id: 1, raceUuid: "race-1", name, subCategory: null, laps: 5, lapsCounter: 0, riders: 0, startTime: null,
     isConnected: false, color: null, heat: 1, status: "running", ...over }) as CategoryProps;
const rider = (bib: number, category: string, over: Partial<RiderProps> = {}) =>
  makeRider({ id: bib, bibNumber: bib, category, raceStatus: "running", timeStartRace: START.toISOString(), totalLaps: 5,
    lapsCounter: 0, lapsDetails: [], timeArrive: null, ...over });

const mount = (cats: CategoryProps[], initial: RiderProps[], enabled = true) =>
  renderHook(() => {
    const [riders, setRiders] = useState(initial);
    const [displayOrder, setDisplayOrder] = useState(initial.map((r) => r.id));
    const phases = computeGroupPhases(cats, riders, enabled);
    const phase = (bib: number) => {
      const p = phaseOfRider(riders.find((r) => r.bibNumber === bib)!, cats, phases);
      return `${p.icon}:${p.remaining}`;
    };
    const isOnTrackAfterEnd = (r: RiderProps) =>
      cats.find((c) => riderInCategory(r, c))?.status === "finished" ||
      (r.raceStatus !== "finished" && phaseOfRider(r, cats, phases).nextCrossingFinishes);
    const lap = useLapRecording({
      raceUuid: "race-1", persistKey: "race-1:heat:1", riders,
      updateRider: (r) => setRiders((prev) => prev.map((x) => (x.id === r.id ? r : x))),
      updateAllRiders: (all) => setRiders(all),
      circuitKm: null, isOnTrackAfterEnd, getCatColor: () => "#f00",
      displayOrder, setDisplayOrder, boardHoldMs: 0, minLapMsOverride: 1000,
    });
    const of = (bib: number) => riders.find((r) => r.bibNumber === bib)!;
    return { lap, riders, phase, of };
  });

type Mounted = ReturnType<typeof mount>["result"];
/** One crossing of `bib`, a little later than the previous one. */
const cross = (result: Mounted, bib: number) => {
  act(() => { vi.advanceTimersByTime(LAP / 5); });
  act(() => result.current.lap.recordLap(result.current.of(bib)));
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(START);
  recordRaceEvent.mockReset().mockResolvedValue({});
  canForRace.mockReset().mockReturnValue(true);
});

describe("bell / flag phases — the 5-lap example with 112, 102 and 107", () => {
  it("runs the four stages exactly; actual laps and crossing times are never changed", () => {
    const elite = cat("Elite");
    const { result } = mount([elite], [rider(112, "Elite"), rider(102, "Elite"), rider(107, "Elite")]);
    // Before stage 1: 112 three laps, 102 two, 107 one.
    for (const bib of [112, 102, 107, 112, 102, 112]) cross(result, bib);

    // Stage 1: 112 completed lap 3 → BELL, 2 to go; 102 and 107 normal.
    expect(result.current.of(112).lapsCounter).toBe(3);
    expect(result.current.phase(112)).toBe("bell:2");
    expect(result.current.phase(102)).toBe("none:3");
    expect(result.current.phase(107)).toBe("none:4");

    // Stage 2: 112 gets the bell (lap 4) → FLAG, 1 to go; everyone else BELL, 2 to go.
    cross(result, 112);
    expect(result.current.phase(112)).toBe("flag:1");
    expect(result.current.phase(102)).toBe("bell:2");
    expect(result.current.phase(107)).toBe("bell:2");

    // Stage 3: 102 crosses (gets the bell) → FLAG, 1 to go; 107 stays BELL, 2 to go.
    cross(result, 102);
    expect(result.current.of(102)).toMatchObject({ lapsCounter: 3, raceStatus: "running" });
    expect(result.current.phase(102)).toBe("flag:1");
    expect(result.current.phase(107)).toBe("bell:2");

    // Stage 4: 112 crosses and finishes → Finished; 102 and 107 FLAG, 0 to go.
    cross(result, 112);
    expect(result.current.of(112)).toMatchObject({ lapsCounter: 5, raceStatus: "finished" });
    expect(result.current.phase(112)).toBe("finished:0");
    expect(result.current.phase(102)).toBe("flag:0");
    expect(result.current.phase(107)).toBe("flag:0");
    // Category-wide finish display ≠ a recorded finish: nobody else is finished, laps untouched.
    expect(result.current.of(102)).toMatchObject({ lapsCounter: 3, raceStatus: "running" });
    expect(result.current.of(107)).toMatchObject({ lapsCounter: 1, raceStatus: "running" });
    expect(result.current.of(107).lapsDetails).toHaveLength(1);

    // Their next crossings finish them, each with their own laps and time.
    cross(result, 107);
    expect(result.current.of(107)).toMatchObject({ lapsCounter: 2, raceStatus: "finished" });
    cross(result, 102);
    expect(result.current.of(102)).toMatchObject({ lapsCounter: 4, raceStatus: "finished" });
    expect(Date.parse(String(result.current.of(102).timeArrive))).toBeGreaterThan(Date.parse(String(result.current.of(107).timeArrive)));
  });

  it("a FLAG rider who crosses before the leader finishes is the first finish", () => {
    const { result } = mount([cat("Elite")], [rider(112, "Elite"), rider(102, "Elite"), rider(107, "Elite")]);
    for (const bib of [112, 112, 112, 112]) cross(result, bib); // 112 got the bell
    cross(result, 102); // 102 gets the bell → FLAG
    cross(result, 102); // 102's next crossing: finish
    expect(result.current.of(102)).toMatchObject({ lapsCounter: 2, raceStatus: "finished" });
    expect(result.current.phase(112)).toBe("flag:0");
    expect(result.current.phase(107)).toBe("flag:0");
  });

  it("undoing the leader's finish restores the earlier phase for everyone", () => {
    const { result } = mount([cat("Elite")], [rider(112, "Elite"), rider(107, "Elite")]);
    for (let i = 0; i < 5; i++) cross(result, 112);
    expect(result.current.phase(107)).toBe("flag:0");
    act(() => { result.current.lap.revertLap(result.current.of(112)); });
    expect(result.current.of(112)).toMatchObject({ lapsCounter: 4, raceStatus: "running" });
    expect(result.current.phase(112)).toBe("flag:1");
    expect(result.current.phase(107)).toBe("bell:2");
  });

  it("an explicit Finish Group shares the phases across categories and waves; other categories stay independent", () => {
    const men = cat("Men L2", { linkGroup: "1", heat: 1 });
    const women = cat("Women L2", { linkGroup: "1", heat: 3, laps: 3 });
    const kids = cat("Kids", { heat: 1 });
    const { result } = mount([men, women, kids], [
      rider(1, "Women L2", { totalLaps: 3 }), rider(2, "Men L2"), rider(3, "Kids"),
    ]);
    cross(result, 2);
    cross(result, 1);
    cross(result, 1); // women's rider gets the bell (lap 2 of 3)
    expect(result.current.phase(1)).toBe("flag:1");
    expect(result.current.phase(2)).toBe("bell:2");
    expect(result.current.phase(3)).toBe("none:5");
    cross(result, 1); // first finish of the Finish Group
    expect(result.current.phase(2)).toBe("flag:0");
    expect(result.current.phase(3)).toBe("none:5");
  });

  it("with first-finish-all-finish off, only each rider's own count drives the icons", () => {
    const { result } = mount([cat("Elite")], [rider(112, "Elite"), rider(107, "Elite")], false);
    for (let i = 0; i < 4; i++) cross(result, 112);
    expect(result.current.phase(112)).toBe("flag:1");
    expect(result.current.phase(107)).toBe("none:5");
  });

  it("is derived from recorded crossings only, so a reload computes the same phases", () => {
    const { result } = mount([cat("Elite")], [rider(112, "Elite"), rider(102, "Elite")]);
    for (let i = 0; i < 4; i++) cross(result, 112);
    const reloaded = JSON.parse(JSON.stringify(result.current.riders)) as RiderProps[];
    const phases = computeGroupPhases([cat("Elite")], reloaded);
    const p = phaseOfRider(reloaded.find((r) => r.bibNumber === 102)!, [cat("Elite")], phases);
    expect(`${p.icon}:${p.remaining}`).toBe("bell:2");
  });
});
