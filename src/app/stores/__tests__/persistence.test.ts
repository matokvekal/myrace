import { describe, it, expect, beforeEach, vi } from "vitest";
import useRiderStore from "../ridersStore";
import useRaceStore, { blockedFinalizedFields } from "../racesStore";
import { initIndexedDB } from "../indexDb/indexedDbHelper";
import { makeRider } from "@/test/factories";
import type { RaceProps } from "@/types/types";

const reset = () => {
  useRiderStore.setState({ riders: [], lastFetchedRaceUuid: "" });
  useRaceStore.setState({ races: [] });
};

const idbRiders = async () => {
  const db = await initIndexedDB();
  const all = await db.getAll("riders");
  db.close();
  return all;
};

const makeRace = (over: Partial<RaceProps> = {}): RaceProps =>
  ({ id: 1, uuid: "race-1", name: "Test Race", ...over }) as RaceProps;

beforeEach(() => {
  reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("riders store: persistence and reload", () => {
  it("addNewRider writes to IndexedDB and survives a simulated reload", async () => {
    const rider = makeRider({ raceUuid: "race-1", bibNumber: 77 });
    await useRiderStore.getState().addNewRider(rider);
    expect((await idbRiders()).map((r) => r.bibNumber)).toEqual([77]);

    // "Reload": wipe the in-memory cache, then load again from disk.
    reset();
    const loaded = await useRiderStore.getState().getRiders("race-1");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].bibNumber).toBe(77);
  });

  it("an edited bib number persists across reload", async () => {
    const rider = makeRider({ raceUuid: "race-1", bibNumber: 10 });
    await useRiderStore.getState().addNewRider(rider);
    await useRiderStore.getState().updateRider({ ...rider, bibNumber: 999 });

    reset();
    const [loaded] = await useRiderStore.getState().getRiders("race-1");
    expect(loaded.bibNumber).toBe(999);
    expect(loaded.id).toBe(rider.id); // identity is the id, never the bib
  });

  it("getRiders only returns riders of the requested race", async () => {
    await useRiderStore.getState().insertRiders([
      makeRider({ raceUuid: "race-1" }),
      makeRider({ raceUuid: "race-2" }),
    ]);
    reset();
    const loaded = await useRiderStore.getState().getRiders("race-2");
    expect(loaded).toHaveLength(1);
    expect(loaded[0].raceUuid).toBe("race-2");
  });

  it("patchRiders updates many riders in one write and keeps array order", async () => {
    const riders = [makeRider(), makeRider(), makeRider()];
    await useRiderStore.getState().insertRiders(riders);
    await useRiderStore
      .getState()
      .patchRiders([{ ...riders[2], checked: true }, { ...riders[0], checked: true }]);

    expect(useRiderStore.getState().riders.map((r) => r.id)).toEqual(riders.map((r) => r.id));
    expect(useRiderStore.getState().riders.map((r) => r.checked)).toEqual([true, false, true]);
    const onDisk = await idbRiders();
    expect(onDisk.filter((r) => r.checked)).toHaveLength(2);
  });

  it("patchRiders with an empty list is a no-op", async () => {
    await expect(useRiderStore.getState().patchRiders([])).resolves.toBeUndefined();
  });

  it("deleteRider removes the rider from memory and disk", async () => {
    const [a, b] = [makeRider(), makeRider()];
    await useRiderStore.getState().insertRiders([a, b]);
    await useRiderStore.getState().deleteRider(a.id);
    expect(useRiderStore.getState().riders.map((r) => r.id)).toEqual([b.id]);
    expect((await idbRiders()).map((r) => r.id)).toEqual([b.id]);
  });

  it("getRidersByHeat / getRidersByCategory filter by race too", async () => {
    await useRiderStore.getState().insertRiders([
      makeRider({ raceUuid: "race-1", heat: 1, category: "Elite" }),
      makeRider({ raceUuid: "race-1", heat: 2, category: "Elite" }),
      makeRider({ raceUuid: "race-2", heat: 1, category: "Elite" }),
    ]);
    expect(useRiderStore.getState().getRidersByHeat("race-1", 1)).toHaveLength(1);
    expect(useRiderStore.getState().getRidersByCategory("race-1", "Elite")).toHaveLength(2);
  });
});

describe("finalized race lock (published results cannot change)", () => {
  const finalizedRace = () =>
    makeRace({ finalized: { version: "1", algo: "SHA-256", at: "", by: "t", nonce: "n", payload: "p", token: "x", riderCount: 1, categoryCount: 1 } });

  it("blocks add / update / patch / import on a finalized race", async () => {
    const rider = makeRider({ raceUuid: "race-1", bibNumber: 5 });
    await useRiderStore.getState().insertRiders([rider]);
    useRaceStore.setState({ races: [finalizedRace()] });

    await useRiderStore.getState().addNewRider(makeRider({ raceUuid: "race-1" }));
    await useRiderStore.getState().updateRider({ ...rider, bibNumber: 6 });
    await useRiderStore.getState().patchRiders([{ ...rider, bibNumber: 7 }]);
    await useRiderStore.getState().insertRiders([makeRider({ raceUuid: "race-1" })]);

    const riders = useRiderStore.getState().riders;
    expect(riders).toHaveLength(1);
    expect(riders[0].bibNumber).toBe(5);
    expect((await idbRiders())[0].bibNumber).toBe(5);
  });

  it("still allows writes to other, non-finalized races", async () => {
    useRaceStore.setState({ races: [finalizedRace()] });
    await useRiderStore.getState().addNewRider(makeRider({ raceUuid: "race-2" }));
    expect(useRiderStore.getState().riders).toHaveLength(1);
  });

  it("blockedFinalizedFields ignores bookkeeping fields but flags real edits", () => {
    const existing = makeRace({ name: "A" });
    expect(blockedFinalizedFields(existing, { ...existing, isFavorite: true })).toEqual([]);
    expect(blockedFinalizedFields(existing, { ...existing, name: "B" })).toEqual(["name"]);
  });

  it("race store refuses to edit a finalized race but allows favouriting", async () => {
    const race = finalizedRace();
    useRaceStore.setState({ races: [race] });
    await useRaceStore.getState().updateRace({ ...race, name: "Renamed" });
    expect(useRaceStore.getState().races[0].name).toBe("Test Race");

    await useRaceStore.getState().updateRace({ ...race, isFavorite: true });
    expect(useRaceStore.getState().races[0].isFavorite).toBe(true);
  });
});

describe("races store: create / edit / delete / reload", () => {
  it("insertRace persists and is replaced (not duplicated) on re-save", async () => {
    await useRaceStore.getState().insertRace(makeRace({ name: "First" }));
    await useRaceStore.getState().insertRace(makeRace({ name: "Renamed" }));
    expect(useRaceStore.getState().races).toHaveLength(1);

    const db = await initIndexedDB();
    const stored = await db.getAll("races");
    db.close();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Renamed");
  });

  it("an edited race survives a reload", async () => {
    const race = makeRace();
    await useRaceStore.getState().insertRace(race);
    await useRaceStore.getState().updateRace({ ...race, name: "Edited" });
    useRaceStore.setState({ races: [] });
    const loaded = await useRaceStore.getState().getRaces();
    expect(loaded[0].name).toBe("Edited");
  });

  it("deleteRace also removes that race's riders and categories, and nothing else", async () => {
    await useRaceStore.getState().insertRace(makeRace({ id: 1, uuid: "race-1" }));
    await useRaceStore.getState().insertRace(makeRace({ id: 2, uuid: "race-2" }));
    await useRiderStore.getState().insertRiders([
      makeRider({ raceUuid: "race-1" }),
      makeRider({ raceUuid: "race-2" }),
    ]);

    await useRaceStore.getState().deleteRace("race-1");

    expect(useRaceStore.getState().races.map((r) => r.uuid)).toEqual(["race-2"]);
    const left = await idbRiders();
    expect(left.map((r) => r.raceUuid)).toEqual(["race-2"]);
  });
});
