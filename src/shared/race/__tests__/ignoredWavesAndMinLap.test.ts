import { beforeEach, describe, expect, it } from "vitest";
import { applyAction, deriveRider, groupFinishAt, rankRiders, raceMinLapMs, type RiderMark } from "../engine";
import { makeAction, makeCategory, makeRaceState, makeRider, resetHarnessIds, T0 } from "../testing";
import { raceSettings } from "../state";

/** Ignored waves (009) and the configurable minimum lap interval, in the shared rules engine. */
const MIN = 60_000;
let seq = 0;
const lap = (at: number): RiderMark => ({ actionId: `a${++seq}`, seq, type: "AddLap", at });
beforeEach(() => {
  resetHarnessIds();
  seq = 0;
});

describe("ignored waves", () => {
  const setup = () => {
    const live = makeCategory({ name: "Elite", heat: 1, laps: 3, status: "running", startedAt: T0, linkGroup: "1" });
    const ignored = makeCategory({ name: "קטגוריה", heat: 9, laps: 3, ignored: true, linkGroup: "1" });
    const a = makeRider({ category: "Elite", heat: 1, bibNumber: 1 });
    const b = makeRider({ category: "Elite", heat: 1, bibNumber: 2 });
    const ghost = makeRider({ category: "קטגוריה", heat: 9, bibNumber: 0, firstName: "שם פרטי", lastName: "שם משפחה" });
    return { state: makeRaceState({ categories: [live, ignored], riders: [a, b, ghost] }), live, ignored, a, b, ghost };
  };

  it("cannot be started, and its riders get no laps", () => {
    const { state, ghost } = setup();
    // The running wave 1 blocks other starts anyway; finish it first.
    for (const c of Object.values(state.categories)) if (c.heat === 1) c.status = "finished";
    expect(applyAction(state, makeAction("WaveStarted", { heat: 9 }), T0 + MIN)).toEqual({ applied: true, changes: expect.anything() });
    expect(Object.values(state.categories).find((c) => c.heat === 9)?.status).toBe("upcoming"); // nothing to start
    expect(applyAction(state, makeAction("AddLap", { riderUuid: ghost.uuid }), T0 + 2 * MIN)).toEqual({ applied: false, reason: "locked" });
  });

  it("its riders take no position, and it never joins a Finish Group's finish", () => {
    const { state, a, b, ghost } = setup();
    deriveRider(state, a.uuid, [lap(T0 + 8 * MIN)]);
    deriveRider(state, b.uuid, [lap(T0 + 9 * MIN)]);
    rankRiders(state);
    expect([state.riders[a.uuid].position_race, state.riders[b.uuid].position_race]).toEqual([1, 2]);
    expect(state.riders[ghost.uuid].position_race).toBe(0);
    const live = Object.values(state.categories).find((c) => c.heat === 1)!;
    expect(groupFinishAt(state, live)).toBeNull();
  });

  it("is ignored and restored with CategoryEdited, keeping its riders", () => {
    const { state, ignored, ghost } = setup();
    expect(applyAction(state, makeAction("CategoryEdited", { categoryUuid: ignored.uuid, changes: { ignored: false } }), T0).applied).toBe(true);
    expect(state.categories[ignored.uuid].ignored).toBe(false);
    expect(state.riders[ghost.uuid]).toBeDefined();
    expect(applyAction(state, makeAction("CategoryEdited", { categoryUuid: ignored.uuid, changes: { ignored: true } }), T0).applied).toBe(true);
    expect(state.categories[ignored.uuid].ignored).toBe(true);
  });
});

describe("minimum lap interval", () => {
  const raceWith = (minLapSeconds: number | null) => {
    const cat = makeCategory({ name: "Elite", heat: 1, laps: 9, status: "running", startedAt: T0 });
    const r = makeRider({ category: "Elite", heat: 1, bibNumber: 1 });
    return { state: makeRaceState({ categories: [cat], riders: [r], race: { minLapSeconds } }), r };
  };

  it("existing races (null) keep 60 s; a race's own value applies to re-derivation", () => {
    const legacy = raceWith(null);
    expect(raceMinLapMs(legacy.state)).toBe(60_000);
    expect(raceSettings(legacy.state.race).minLapSeconds).toBe(60);
    deriveRider(legacy.state, legacy.r.uuid, [lap(T0 + 5 * MIN), lap(T0 + 7 * MIN)]);
    expect(legacy.state.riders[legacy.r.uuid].lapsCounter).toBe(2);

    const strict = raceWith(180);
    deriveRider(strict.state, strict.r.uuid, [lap(T0 + 5 * MIN), lap(T0 + 7 * MIN), lap(T0 + 10 * MIN)]);
    // 7:00 is 2 min after 5:00 → not counted; 10:00 is 5 min after → counted. Multiple real laps still count.
    expect(strict.state.riders[strict.r.uuid].lapsCounter).toBe(2);
  });

  it("is a race setting (SettingChanged), validated 0–3600", () => {
    const { state } = raceWith(null);
    expect(applyAction(state, makeAction("SettingChanged", { changes: { minLapSeconds: 180 } }), T0).applied).toBe(true);
    expect(state.race.minLapSeconds).toBe(180);
    expect(applyAction(state, makeAction("SettingChanged", { changes: { minLapSeconds: 5000 } }), T0)).toEqual({ applied: false, reason: "invalid" });
  });
});
