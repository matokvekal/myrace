/**
 * Perf (2026-11-15): a lap used to rewrite the whole race in IndexedDB (~1,000-2,000 puts
 * per tap with 500 riders). Now each change writes only the riders it changes — and what
 * is on disk must still equal what is in memory, so a reload restores the same race.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import useRiderStore, { sameRider } from "../ridersStore";
import { initIndexedDB } from "../indexDb/indexedDbHelper";
import calculatePositions from "@/utils/calculatePosition";
import { rankingWrites } from "@/race/[id]/heat/[heatId]/useLapRecording";
import { makeRider } from "@/test/factories";
import type { RiderProps } from "@/types/types";

const idbRiders = async (): Promise<RiderProps[]> => {
  const db = await initIndexedDB();
  const all = (await db.getAll("riders")) as RiderProps[];
  db.close();
  return all;
};
let puts = 0;
const realPut = IDBObjectStore.prototype.put;
const settle = () => new Promise((r) => setTimeout(r, 30)); // the store's IDB writes are async

beforeEach(() => {
  useRiderStore.setState({ riders: [], lastFetchedRaceUuid: "" });
  vi.spyOn(console, "log").mockImplementation(() => {});
  puts = 0;
  IDBObjectStore.prototype.put = function (...a: Parameters<IDBObjectStore["put"]>) {
    if (this.name === "riders") puts++;
    return realPut.apply(this, a);
  };
});
afterEach(() => {
  IDBObjectStore.prototype.put = realPut;
});

/** 6 running riders, 2 categories, 2 laps each, staggered arrivals. */
async function seedRace(): Promise<RiderProps[]> {
  const t0 = Date.parse("2026-11-15T09:00:00Z");
  const riders = Array.from({ length: 6 }, (_, i) =>
    makeRider({
      raceUuid: "race-1",
      category: i < 3 ? "Elite" : "Masters",
      raceStatus: "running",
      lapsCounter: 2,
      timeArrive: new Date(t0 + (i + 1) * 1000).toISOString(),
      status: "standing",
    }),
  );
  const ranked = calculatePositions(riders);
  await useRiderStore.getState().insertRiders(ranked);
  await settle();
  puts = 0;
  return useRiderStore.getState().riders;
}

describe("rider persistence writes only what changed", () => {
  it("a single-rider update writes ONE rider (no whole-store rewrite by the persist middleware)", async () => {
    const riders = await seedRace();
    await useRiderStore.getState().updateRider({ ...riders[0], comment: "x" });
    await settle();
    expect(puts).toBe(1);
  });

  it("a lap re-ranking writes only riders whose position changed, and disk equals memory after reload", async () => {
    const base = await seedRace();
    // The LAST Elite rider (3rd) completes a lap: now 1st in Elite and 1st overall.
    const last = base.filter((r) => r.category === "Elite").sort((a, b) => a.position_category! - b.position_category!)[2];
    const updated: RiderProps = { ...last, lapsCounter: 3, timeArrive: "2026-11-15T09:10:00.000Z" };
    const sorted = calculatePositions(base.map((r) => (r.id === updated.id ? updated : r)));
    const self = sorted.find((r) => r.id === updated.id)!;
    const written = { ...updated, position_category: self.position_category }; // what recordLap passes to updateRider
    const final = sorted.map((r) => (r.id === written.id ? written : r));

    const ids = rankingWrites(base, final, written);
    expect(ids.has(written.id)).toBe(false); // already written by updateRider
    // Elite #1 and #2 moved down; Masters riders moved in the overall ranking only if they were behind.
    for (const r of final) {
      const b = base.find((x) => x.id === r.id)!;
      const moved = r.id !== written.id && (b.position_category !== r.position_category || b.position_race !== r.position_race);
      expect(ids.has(r.id)).toBe(moved);
    }

    await useRiderStore.getState().updateRider(written);
    await useRiderStore.getState().updateAllRiders(final, ids);
    await settle();
    expect(puts).toBe(1 + ids.size); // was 1 + 6 + (2 x 6 persist rewrites) before

    // Memory: the full ranked list, in ranked order at the end (unchanged behaviour).
    expect(useRiderStore.getState().riders.slice(-final.length).map((r) => r.id)).toEqual(final.map((r) => r.id));
    // Reload: what is on disk is exactly what was in memory.
    const mem = new Map(useRiderStore.getState().riders.map((r) => [r.id, r]));
    const disk = await idbRiders();
    expect(disk).toHaveLength(6);
    for (const d of disk) {
      const m = mem.get(d.id)!;
      expect([d.lapsCounter, d.position_category, d.position_race, d.timeArrive]).toEqual([m.lapsCounter, m.position_category, m.position_race, m.timeArrive]);
    }
  });

  it("the rider just changed IS written when the ranking gives it different positions than updateRider wrote (undo/redo of a finish)", () => {
    const a = makeRider({ id: 9001, position_category: 3, position_race: 5 });
    const b = makeRider({ id: 9002, position_category: 1, position_race: 1 });
    const ranked = [{ ...a, position_category: 1, position_race: 1 }, { ...b, position_category: 2, position_race: 2 }];
    expect([...rankingWrites([a, b], ranked, a)].sort()).toEqual([9001, 9002]);
  });

  it("without persistIds updateAllRiders still writes every rider passed (other callers unchanged)", async () => {
    const base = await seedRace();
    await useRiderStore.getState().updateAllRiders(base.map((r) => ({ ...r, checked: true })));
    await settle();
    expect(puts).toBe(6);
  });
});

describe("patchRiders skips rows identical to what the device holds (server echoes)", () => {
  it("an identical row costs no store update and no write; a changed row is written", async () => {
    const base = await seedRace();
    const before = useRiderStore.getState().riders;
    await useRiderStore.getState().patchRiders(base.map((r) => ({ ...r })));
    await settle();
    expect(puts).toBe(0);
    expect(useRiderStore.getState().riders).toBe(before); // no re-render trigger

    await useRiderStore.getState().patchRiders([{ ...base[0] }, { ...base[1], lapsCounter: 9 }]);
    await settle();
    expect(puts).toBe(1);
    expect((await idbRiders()).find((r) => r.id === base[1].id)!.lapsCounter).toBe(9);
  });

  it("sameRider never calls a real difference 'same'", () => {
    const r = makeRider({ lapsDetails: [{ lap: 1, startTime: new Date(0), endTime: new Date(1000), lapTime: "00:00:01", position: 1 }] });
    expect(sameRider(r, { ...r })).toBe(true);
    expect(sameRider(r, { ...r, comment: "late" })).toBe(false); // a field outside the quick checks
    expect(sameRider(r, { ...r, lapsDetails: [{ ...r.lapsDetails[0], lapTime: "00:00:02" }] })).toBe(false);
    expect(sameRider(r, { ...r, position_race: 2 })).toBe(false);
  });
});
