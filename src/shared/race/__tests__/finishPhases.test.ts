import { describe, it, expect } from "vitest";
import { crossingFinishes, groupPhase, riderPhase, NO_GROUP_PHASE, type PhaseRider } from "../finishPhases";

/** The 5-lap example: riders 112, 102 and 107 of one category. Times in minutes. */
const MIN = 60_000;
const rider = (crossingsMin: number[], finished = false): PhaseRider => ({
  laps: 5, crossings: crossingsMin.map((m) => m * MIN), finished, out: false,
});
const view = (r: PhaseRider, all: PhaseRider[]) => {
  const p = riderPhase(r, groupPhase(all));
  return `${p.icon}:${p.remaining}`;
};

describe("bell / flag phases — the 5-lap example (112, 102, 107)", () => {
  it("stage 1: 112 completes lap 3 → 112 BELL (2 to go); 102 and 107 unchanged", () => {
    const r112 = rider([10, 20, 30]);
    const r102 = rider([11, 22]);
    const r107 = rider([12]);
    const all = [r112, r102, r107];
    expect(view(r112, all)).toBe("bell:2");
    expect(view(r102, all)).toBe("none:3");
    expect(view(r107, all)).toBe("none:4");
  });

  it("stage 2: 112 gets the bell (lap 4) → 112 FLAG (1 to go); everyone else BELL, 2 to go", () => {
    const r112 = rider([10, 20, 30, 40]);
    const r102 = rider([11, 22]);
    const r107 = rider([12]);
    const all = [r112, r102, r107];
    expect(groupPhase(all)).toEqual({ bellAt: 40 * MIN, finishAt: null });
    expect(view(r112, all)).toBe("flag:1");
    expect(view(r102, all)).toBe("bell:2");
    expect(view(r107, all)).toBe("bell:2");
    // Getting the bell is not a finish.
    expect(crossingFinishes(r102, r102.crossings, 41 * MIN, groupPhase([r112, r107]))).toBe(false);
  });

  it("stage 3: 102 crosses and gets the bell → 102 FLAG (1 to go); 107 stays BELL (2 to go)", () => {
    const r112 = rider([10, 20, 30, 40]);
    const r102 = rider([11, 22, 41]);
    const r107 = rider([12]);
    const all = [r112, r102, r107];
    expect(view(r112, all)).toBe("flag:1");
    expect(view(r102, all)).toBe("flag:1");
    expect(view(r107, all)).toBe("bell:2");
    // Actual laps are untouched: 102 has 3 recorded crossings.
    expect(r102.crossings).toHaveLength(3);
  });

  it("stage 4: 112 finishes → 112 Finished (0); 102 and 107 FLAG, 0 to go — even 107 who never got the bell", () => {
    const r112 = rider([10, 20, 30, 40, 50], true);
    const r102 = rider([11, 22, 41]);
    const r107 = rider([12]);
    const all = [r112, r102, r107];
    expect(groupPhase(all)).toEqual({ bellAt: 40 * MIN, finishAt: 50 * MIN });
    expect(view(r112, all)).toBe("finished:0");
    expect(view(r102, all)).toBe("flag:0");
    expect(view(r107, all)).toBe("flag:0");
    // No finish is recorded for them until they cross; then the crossing finishes them.
    expect(r107.finished).toBe(false);
    const others = groupPhase([r112, r102]);
    expect(crossingFinishes(r107, r107.crossings, 55 * MIN, others)).toBe(true);
  });

  it("a FLAG rider's next crossing is their finish, even before the leader's (102 first to finish)", () => {
    const r112 = rider([10, 20, 30, 40]);
    const r102 = rider([11, 22, 41]);
    expect(crossingFinishes(r102, r102.crossings, 45 * MIN, groupPhase([r112]))).toBe(true);
    const r102done = rider([11, 22, 41, 45], true);
    expect(groupPhase([r112, r102done]).finishAt).toBe(45 * MIN);
    expect(view(r112, [r112, r102done])).toBe("flag:0");
  });

  it("without the group (setting off / no group) only the rider's own count drives the icons", () => {
    expect(riderPhase(rider([10, 20, 30]), NO_GROUP_PHASE)).toMatchObject({ icon: "bell", remaining: 2 });
    expect(riderPhase(rider([10, 20, 30, 40]), NO_GROUP_PHASE)).toMatchObject({ icon: "flag", remaining: 1 });
    expect(riderPhase(rider([10]), NO_GROUP_PHASE)).toMatchObject({ icon: "none", remaining: 4 });
  });

  it("an out rider (DNF) never triggers the bell; a manual finish short of laps never triggers the finish", () => {
    const dnf = { ...rider([10, 20, 30, 40]), out: true };
    expect(groupPhase([dnf, rider([12])]).bellAt).toBeNull();
    const manual = rider([10, 20], true); // finished by hand on lap 2 of 5
    expect(groupPhase([manual, rider([12])]).finishAt).toBeNull();
  });
});
