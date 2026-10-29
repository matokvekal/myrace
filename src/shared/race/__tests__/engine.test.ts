import { beforeEach, describe, expect, it } from "vitest";
import { applyAction, deriveRider, groupFinishAt, MIN_LAP_MS, rankRiders, type RiderMark } from "../engine";
import { makeAction, makeCategory, makeRaceState, makeRider, resetHarnessIds, T0 } from "../testing";
import type { RaceState } from "../state";

/**
 * Stories 2.3/2.4/2.6 — the rules engine reproduces the app's live-screen and
 * StartManager rules. Times are on the race clock (ms).
 */

const MIN = 60_000;
let seq = 0;
const lap = (at: number, extra: Partial<RiderMark> = {}): RiderMark => ({ actionId: `a${++seq}`, seq, type: "AddLap", at, ...extra });

function race(opts: { laps?: number; riders?: number; leaderFinishAll?: boolean } = {}) {
  const cat = makeCategory({ name: "Elite", heat: 1, laps: opts.laps ?? 3, status: "running", startedAt: T0 });
  const riders = Array.from({ length: opts.riders ?? 3 }, (_, i) => makeRider({ category: "Elite", heat: 1, bibNumber: i + 1 }));
  const state = makeRaceState({ categories: [cat], riders, race: { leaderFinishAll: opts.leaderFinishAll ?? null } });
  return { state, cat, riders };
}

beforeEach(() => {
  resetHarnessIds();
  seq = 0;
});

describe("laps from marks", () => {
  it("lap times, elapsed time and arrival from the wave start", () => {
    const { state, riders } = race();
    deriveRider(state, riders[0].uuid, [lap(T0 + 8 * MIN), lap(T0 + 16.5 * MIN)]);
    const r = state.riders[riders[0].uuid];
    expect(r.lapsDetails.map((l) => l.lapTime)).toEqual(["08:00", "08:30"]);
    expect(r).toMatchObject({ lapsCounter: 2, elapsedLastLap: "08:30", elapsedTimeFromStart: "16:30", raceStatus: "running" });
    expect(r.timeArrive).toBe(new Date(T0 + 16.5 * MIN).toISOString());
  });

  it("a crossing within 60 s of the last counted lap does not count (duplicate tap)", () => {
    const { state, riders } = race();
    deriveRider(state, riders[0].uuid, [lap(T0 + 8 * MIN), lap(T0 + 8 * MIN + MIN_LAP_MS - 1)]);
    expect(state.riders[riders[0].uuid].lapsCounter).toBe(1);
  });

  it("a crossing before the start does not count", () => {
    const { state, riders } = race();
    deriveRider(state, riders[0].uuid, [lap(T0 - MIN)]);
    expect(state.riders[riders[0].uuid].lapsCounter).toBe(0);
  });

  it("a late (offline) lap with an earlier time lands in its place", () => {
    const { state, riders } = race({ laps: 5 });
    const marks = [lap(T0 + 20 * MIN), lap(T0 + 10 * MIN)]; // arrived in this order
    deriveRider(state, riders[0].uuid, marks);
    expect(state.riders[riders[0].uuid].lapsDetails.map((l) => l.lapTime)).toEqual(["10:00", "10:00"]);
  });

  it("finishes at total laps; later crossings are kept but not counted", () => {
    const { state, riders } = race({ laps: 2 });
    deriveRider(state, riders[0].uuid, [lap(T0 + 8 * MIN), lap(T0 + 16 * MIN), lap(T0 + 24 * MIN)]);
    expect(state.riders[riders[0].uuid]).toMatchObject({ lapsCounter: 2, raceStatus: "finished" });
  });

  it("an undone mark is ignored — exactly that one", () => {
    const { state, riders } = race();
    deriveRider(state, riders[0].uuid, [lap(T0 + 8 * MIN), lap(T0 + 12 * MIN, { undone: true }), lap(T0 + 16 * MIN)]);
    expect(state.riders[riders[0].uuid].lapsDetails.map((l) => l.lapTime)).toEqual(["08:00", "08:00"]);
  });

  it("a lap-count correction absorbs laps tapped before it; later laps count on", () => {
    const { state, riders } = race({ laps: 10 });
    const marks: RiderMark[] = [lap(T0 + 8 * MIN), { actionId: "c", seq: 99, type: "LapCountCorrection", at: T0 + 9 * MIN, laps: 4 }, lap(T0 + 12 * MIN)];
    deriveRider(state, riders[0].uuid, marks);
    expect(state.riders[riders[0].uuid].lapsCounter).toBe(5);
  });

  it("a manual finish ends the rider's race; an undone finish does not", () => {
    const { state, riders } = race();
    deriveRider(state, riders[0].uuid, [lap(T0 + 8 * MIN), { actionId: "f", seq: 5, type: "RiderFinished", at: T0 + 9 * MIN }, lap(T0 + 16 * MIN)]);
    expect(state.riders[riders[0].uuid]).toMatchObject({ lapsCounter: 1, raceStatus: "finished" });
    deriveRider(state, riders[0].uuid, [lap(T0 + 8 * MIN), { actionId: "f", seq: 5, type: "RiderFinished", at: T0 + 9 * MIN, undone: true }, lap(T0 + 16 * MIN)]);
    expect(state.riders[riders[0].uuid]).toMatchObject({ lapsCounter: 2, raceStatus: "running" });
  });
});

describe("finish rules across riders", () => {
  it("after the category is finished, a rider still on track finishes on the next crossing", () => {
    const { state, cat, riders } = race({ laps: 5 });
    applyAction(state, makeAction("CategoryFinished", { categoryUuid: cat.uuid }), T0 + 20 * MIN);
    deriveRider(state, riders[0].uuid, [lap(T0 + 10 * MIN), lap(T0 + 21 * MIN)]);
    expect(state.riders[riders[0].uuid]).toMatchObject({ lapsCounter: 2, raceStatus: "finished" });
  });

  it("first finish – all finish: once the leader completed every lap, the next crossing finishes the others", () => {
    const { state, riders } = race({ laps: 2 });
    deriveRider(state, riders[0].uuid, [lap(T0 + 8 * MIN), lap(T0 + 16 * MIN)]);
    expect(groupFinishAt(state, Object.values(state.categories)[0])).toBe(T0 + 16 * MIN);
    deriveRider(state, riders[1].uuid, [lap(T0 + 17 * MIN)]);
    expect(state.riders[riders[1].uuid]).toMatchObject({ lapsCounter: 1, raceStatus: "finished" });
  });

  it("a Finish Group across waves and distances: the first finish finishes the others at their next crossing", () => {
    const men = makeCategory({ name: "Men L2", heat: 1, laps: 6, status: "running", startedAt: T0, linkGroup: "1" });
    const women = makeCategory({ name: "Women L2", heat: 3, laps: 2, status: "running", startedAt: T0, linkGroup: "1" });
    const w = makeRider({ category: "Women L2", heat: 3, bibNumber: 1 });
    const m = makeRider({ category: "Men L2", heat: 1, bibNumber: 2 });
    const state = makeRaceState({ categories: [men, women], riders: [w, m], race: { leaderFinishAll: null } });
    deriveRider(state, m.uuid, [lap(T0 + 7 * MIN)]);
    deriveRider(state, w.uuid, [lap(T0 + 8 * MIN), lap(T0 + 16 * MIN)]);
    expect(state.riders[w.uuid]).toMatchObject({ lapsCounter: 2, raceStatus: "finished" });
    expect(state.riders[m.uuid]).toMatchObject({ lapsCounter: 1, raceStatus: "running" }); // nothing invented
    deriveRider(state, m.uuid, [lap(T0 + 7 * MIN), lap(T0 + 17 * MIN)]);
    expect(state.riders[m.uuid]).toMatchObject({ lapsCounter: 2, raceStatus: "finished" });
  });

  it("server derives the 5-lap bell/flag example (112, 102, 107) like the live screen", () => {
    const { state, riders } = race({ laps: 5, riders: 3 });
    const [r112, r102, r107] = riders;
    deriveRider(state, r107.uuid, [lap(T0 + 6 * MIN)]);
    deriveRider(state, r102.uuid, [lap(T0 + 5 * MIN), lap(T0 + 11 * MIN)]);
    // 112 gets the bell (lap 4) at 20 min.
    deriveRider(state, r112.uuid, [lap(T0 + 5 * MIN), lap(T0 + 10 * MIN), lap(T0 + 15 * MIN), lap(T0 + 20 * MIN)]);
    // 102 crosses after the bell: gets the bell, not a finish.
    deriveRider(state, r102.uuid, [lap(T0 + 5 * MIN), lap(T0 + 11 * MIN), lap(T0 + 21 * MIN)]);
    expect(state.riders[r102.uuid]).toMatchObject({ lapsCounter: 3, raceStatus: "running" });
    // 112 finishes at 25 min (first finish).
    deriveRider(state, r112.uuid, [lap(T0 + 5 * MIN), lap(T0 + 10 * MIN), lap(T0 + 15 * MIN), lap(T0 + 20 * MIN), lap(T0 + 25 * MIN)]);
    expect(state.riders[r112.uuid]).toMatchObject({ lapsCounter: 5, raceStatus: "finished" });
    // 107 never got the bell: still finishes at their next crossing, on their own 2 laps.
    deriveRider(state, r107.uuid, [lap(T0 + 6 * MIN), lap(T0 + 26 * MIN)]);
    expect(state.riders[r107.uuid]).toMatchObject({ lapsCounter: 2, raceStatus: "finished" });
    // 102 (FLAG) finishes at their next crossing with 4 laps.
    deriveRider(state, r102.uuid, [lap(T0 + 5 * MIN), lap(T0 + 11 * MIN), lap(T0 + 21 * MIN), lap(T0 + 27 * MIN)]);
    expect(state.riders[r102.uuid]).toMatchObject({ lapsCounter: 4, raceStatus: "finished" });
  });

  it("without a Finish Group, another category's finish never finishes a rider", () => {
    const a = makeCategory({ name: "Men L2", heat: 1, laps: 6, status: "running", startedAt: T0 });
    const b = makeCategory({ name: "Women L2", heat: 1, laps: 2, status: "running", startedAt: T0 });
    const w = makeRider({ category: "Women L2", heat: 1, bibNumber: 1 });
    const m = makeRider({ category: "Men L2", heat: 1, bibNumber: 2 });
    const state = makeRaceState({ categories: [a, b], riders: [w, m], race: { leaderFinishAll: null } });
    deriveRider(state, w.uuid, [lap(T0 + 8 * MIN), lap(T0 + 16 * MIN)]);
    deriveRider(state, m.uuid, [lap(T0 + 7 * MIN), lap(T0 + 17 * MIN)]);
    expect(state.riders[m.uuid]).toMatchObject({ lapsCounter: 2, raceStatus: "running" });
  });

  it("… unless the race turned first-finish-all-finish off", () => {
    const { state, riders } = race({ laps: 2, leaderFinishAll: false });
    deriveRider(state, riders[0].uuid, [lap(T0 + 8 * MIN), lap(T0 + 16 * MIN)]);
    deriveRider(state, riders[1].uuid, [lap(T0 + 17 * MIN)]);
    expect(state.riders[riders[1].uuid]).toMatchObject({ lapsCounter: 1, raceStatus: "running" });
  });

  it("status never changes laps: DNF keeps the laps and is unranked", () => {
    const { state, riders } = race();
    deriveRider(state, riders[0].uuid, [lap(T0 + 8 * MIN)]);
    applyAction(state, makeAction("StatusCorrection", { riderUuid: riders[0].uuid, status: "DNF" }), T0 + 9 * MIN);
    deriveRider(state, riders[0].uuid, [lap(T0 + 8 * MIN)]);
    rankRiders(state);
    expect(state.riders[riders[0].uuid]).toMatchObject({ status: "DNF", lapsCounter: 1, raceStatus: "finished", position_category: 0 });
  });
});

describe("waves", () => {
  const twoWaves = (): RaceState => {
    const c1 = makeCategory({ name: "W1", heat: 1, laps: 3 });
    const c2 = makeCategory({ name: "W2", heat: 2, laps: 3 });
    return makeRaceState({ categories: [c1, c2], riders: [makeRider({ category: "W1", heat: 1 }), makeRider({ category: "W2", heat: 2 }), makeRider({ category: "W1", heat: 1, status: "DNS" })] });
  };

  it("starting a wave stamps its categories and riders (DNS stays out); one wave at a time", () => {
    const s = twoWaves();
    const r = applyAction(s, makeAction("WaveStarted", { heat: 1 }, { deviceTime: "2026-06-01T13:00:05.000+03:00" } as never), T0);
    expect(r.applied).toBe(true);
    const [c1] = Object.values(s.categories);
    expect(c1).toMatchObject({ status: "running", startedAt: T0 });
    const [w1, , dns] = Object.values(s.riders);
    expect(w1.timeStartRace).toBe("13:00:05"); // the starting phone's local clock, for display
    expect(dns.timeStartRace).toBeNull();
    expect(applyAction(s, makeAction("WaveStarted", { heat: 2 }), T0 + MIN)).toEqual({ applied: false, reason: "locked" });
  });

  it("finishing the wave closes out riders still on track as finishers — never DNF", () => {
    const s = twoWaves();
    applyAction(s, makeAction("WaveStarted", { heat: 1 }), T0);
    const [w1] = Object.values(s.riders);
    w1.raceStatus = "running";
    applyAction(s, makeAction("WaveFinished", { heat: 1 }), T0 + 30 * MIN);
    expect(s.riders[w1.uuid].status).toBe("finished");
    deriveRider(s, w1.uuid, []);
    expect(s.riders[w1.uuid].raceStatus).toBe("finished");
  });

  it("starting the next wave sweeps riders of finished categories still on track", () => {
    const s = twoWaves();
    applyAction(s, makeAction("WaveStarted", { heat: 1 }), T0);
    const [w1] = Object.values(s.riders);
    w1.raceStatus = "running";
    applyAction(s, makeAction("CategoryFinished", { categoryUuid: Object.values(s.categories)[0].uuid }), T0 + 20 * MIN);
    const r = applyAction(s, makeAction("WaveStarted", { heat: 2 }), T0 + 30 * MIN);
    expect(r.applied && r.changes.rederive.has(w1.uuid)).toBe(true);
    expect(s.riders[w1.uuid].status).toBe("finished");
  });
});

describe("setup rules (Story 2.6)", () => {
  it("laps can't go below laps ridden, and a finished category's laps are locked", () => {
    const { state, cat, riders } = race({ laps: 5 });
    state.riders[riders[0].uuid].lapsCounter = 3;
    expect(applyAction(state, makeAction("CategoryEdited", { categoryUuid: cat.uuid, changes: { laps: 2 } }), T0)).toEqual({ applied: false, reason: "locked" });
    expect(applyAction(state, makeAction("CategoryEdited", { categoryUuid: cat.uuid, changes: { laps: 4 } }), T0).applied).toBe(true);
    state.categories[cat.uuid].status = "finished";
    expect(applyAction(state, makeAction("CategoryEdited", { categoryUuid: cat.uuid, changes: { laps: 6 } }), T0)).toEqual({ applied: false, reason: "locked" });
  });

  it("a started category's start time and wave are locked", () => {
    const { state, cat } = race();
    expect(applyAction(state, makeAction("CategoryEdited", { categoryUuid: cat.uuid, changes: { startTime: "11:00" } }), T0)).toEqual({ applied: false, reason: "locked" });
  });

  it("renaming a category moves its riders with it", () => {
    const { state, cat, riders } = race();
    state.categories[cat.uuid].status = "upcoming";
    applyAction(state, makeAction("CategoryEdited", { categoryUuid: cat.uuid, changes: { name: "Elite Men" } }), T0);
    expect(state.riders[riders[0].uuid].category).toBe("Elite Men");
  });

  it("riders with laps can't be deleted or moved; duplicate bibs are refused; derived fields can't be edited", () => {
    const { state, riders } = race();
    state.riders[riders[0].uuid].lapsCounter = 1;
    expect(applyAction(state, makeAction("RiderDeleted", { riderUuid: riders[0].uuid }), T0)).toEqual({ applied: false, reason: "locked" });
    expect(applyAction(state, makeAction("RiderEdited", { riderUuid: riders[0].uuid, changes: { category: "Other" } }), T0)).toEqual({ applied: false, reason: "locked" });
    expect(applyAction(state, makeAction("RiderEdited", { riderUuid: riders[1].uuid, changes: { bibNumber: 1 } }), T0)).toEqual({ applied: false, reason: "invalid" });
    expect(applyAction(state, makeAction("RiderEdited", { riderUuid: riders[1].uuid, changes: { lapsCounter: 9 } as never }), T0)).toEqual({ applied: false, reason: "invalid" });
  });

  it("an import adds only missing categories and never rebuilds existing ones", () => {
    const { state, cat } = race();
    const r = applyAction(state, makeAction("RidersImported", {
      riders: [{ uuid: "00000000-0000-4000-8000-00000000f001", firstName: "N", middleName: null, lastName: "Ew", bibNumber: 77, team: null, chipNumber: null, federation: null, points: null, category: "Kids", subCategory: null, heat: 2, standing: null, flag: null, uciPoints: null, uciNumber: null, image: null, comment: null }],
      categories: [
        { uuid: "00000000-0000-4000-8000-00000000c001", name: "Elite", subCategory: null, laps: 1, heat: 9, startTime: null, color: null, linkGroup: null, importOrder: null },
        { uuid: "00000000-0000-4000-8000-00000000c002", name: "Kids", subCategory: null, laps: 1, heat: 2, startTime: null, color: null, linkGroup: null, importOrder: null },
      ],
    }), T0);
    expect(r.applied).toBe(true);
    expect(state.categories[cat.uuid].laps).toBe(3);
    expect(Object.keys(state.categories)).toHaveLength(2);
  });
});

describe("positions", () => {
  it("more laps first, then earlier arrival; a finisher without a last crossing goes behind", () => {
    const { state, riders } = race({ laps: 5 });
    deriveRider(state, riders[0].uuid, [lap(T0 + 8 * MIN), lap(T0 + 17 * MIN)]);
    deriveRider(state, riders[1].uuid, [lap(T0 + 8.5 * MIN), lap(T0 + 16 * MIN)]);
    deriveRider(state, riders[2].uuid, [lap(T0 + 9 * MIN)]);
    rankRiders(state);
    const order = Object.values(state.riders).sort((a, b) => a.position_category - b.position_category).map((r) => r.bibNumber);
    expect(order).toEqual([2, 1, 3]);
  });
});
