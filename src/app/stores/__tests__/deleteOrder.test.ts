import { describe, it, expect, beforeEach, vi } from "vitest";
import useRiderStore from "../ridersStore";
import useRaceStore from "../racesStore";
import { initIndexedDB } from "../indexDb/indexedDbHelper";
import { makeRider } from "@/test/factories";
import type { RaceProps } from "@/types/types";

/**
 * Story 1.6 — deleting a finalized, downloaded race from the main screen used to
 * purge its riders BEFORE deleting the race. The finalized lock then refused the
 * rider purge, leaving orphan riders in memory that the persist layer wrote
 * back. The main screen now uses the race page's order: race first, then riders.
 */

const finalizedViewOnly = (): RaceProps =>
  ({
    id: 1, uuid: "race-dl", name: "Downloaded", viewOnly: true,
    finalized: { version: "1", algo: "SHA-256", at: "", by: "t", nonce: "n", payload: "p", token: "x", riderCount: 2, categoryCount: 1 },
  }) as RaceProps;

const idbRiders = async () => {
  const db = await initIndexedDB();
  const all = await db.getAll("riders");
  db.close();
  return all;
};

beforeEach(() => {
  useRiderStore.setState({ riders: [], lastFetchedRaceUuid: "" });
  useRaceStore.setState({ races: [] });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

async function seed() {
  const race = finalizedViewOnly();
  await useRaceStore.getState().insertRace(race);
  const db = await initIndexedDB();
  const riders = [makeRider({ id: 11, raceUuid: race.uuid }), makeRider({ id: 12, raceUuid: race.uuid })];
  for (const r of riders) await db.put("riders", r);
  db.close();
  useRiderStore.setState({ riders, lastFetchedRaceUuid: race.uuid });
  return race;
}

describe("deleting a finalized downloaded race", () => {
  it("race first, then riders, leaves no riders in memory or IndexedDB", async () => {
    const race = await seed();

    // The order main/page.tsx handleDeleteRace now uses.
    await useRaceStore.getState().deleteRace(race.uuid);
    await useRiderStore.getState().deleteRidersByRace(race.uuid);

    expect(useRiderStore.getState().riders.filter((r) => r.raceUuid === race.uuid)).toHaveLength(0);
    expect((await idbRiders()).filter((r: any) => r.raceUuid === race.uuid)).toHaveLength(0);
  });

  it("(the old order) riders first is refused by the finalized lock — why the order matters", async () => {
    const race = await seed();
    await useRiderStore.getState().deleteRidersByRace(race.uuid);
    expect(useRiderStore.getState().riders.filter((r) => r.raceUuid === race.uuid)).toHaveLength(2);
  });
});
