/**
 * Hotfix (1.2.1-rc.6): My Races → open a race → the Riders tab showed the riders, then
 * "No riders yet"; another tab and back restored them.
 *
 * Root cause: `getRiders(raceUuid)` REPLACED the whole in-memory riders array with that one
 * race's riders. My Races' account sync (`syncMyRaces`) keeps catching up every linked race
 * in the background, and each catch-up (`applyChangesNow` / `loadSnapshotNow`) calls
 * `getRiders(<that race>)` — so the race on screen was evicted from memory. The Riders
 * screen loads only on mount, so it stayed empty until a remount re-read it.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));

import Riders from "../Riders";
import useRiderStore from "@/stores/ridersStore";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { makeCategory, makeRider } from "@/test/factories";
import type { RiderProps } from "@/types/types";

const RACE = "race-on-screen";
const OTHER = "race-synced-in-background";
const cats = [makeCategory({ name: "Elite", heat: 1, startTime: "09:00", raceUuid: RACE })];
const mine = [11, 12].map((b) => makeRider({ category: "Elite", bibNumber: b, firstName: "R", lastName: `Bib${b}`, raceUuid: RACE }));
const others = [makeRider({ category: "Elite", bibNumber: 99, raceUuid: OTHER })];
const ofRace = (uuid: string) => useRiderStore.getState().riders.filter((r) => r.raceUuid === uuid);

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const db = await initIndexedDB();
  await db.clear("riders");
  for (const r of [...mine, ...others]) await db.put("riders", r);
  db.close();
  useRiderStore.setState({ riders: [], lastFetchedRaceUuid: "" });
});

describe("Riders tab keeps its race's riders while other races load", () => {
  it("a background load of ANOTHER race (My Races sync catch-up) does not empty the Riders tab", async () => {
    render(<Riders raceUuid={RACE} categories={cats} />);
    await waitFor(() => expect(screen.getByText(/Bib11/)).toBeInTheDocument());

    // Exactly what liveClient's catch-up does for each linked race in syncMyRaces.
    await useRiderStore.getState().getRiders(OTHER);

    expect(ofRace(RACE)).toHaveLength(2);
    expect(screen.queryByText(/No riders yet/)).not.toBeInTheDocument();
    expect(screen.getByText(/Bib12/)).toBeInTheDocument();
  });

  it("out-of-order loads of two races keep both (no stale answer wipes the other race)", async () => {
    await Promise.all([useRiderStore.getState().getRiders(RACE), useRiderStore.getState().getRiders(OTHER)]);
    expect(ofRace(RACE)).toHaveLength(2);
    expect(ofRace(OTHER)).toHaveLength(1);
  });

  it("a stale read of the SAME race never replaces a newer completed load", async () => {
    // Two loads of RACE start together; an edit lands after the second one applied.
    const first = useRiderStore.getState().getRiders(RACE);
    useRiderStore.setState({ lastFetchedRaceUuid: "" }); // e.g. manual Refresh forcing a re-read
    const second = useRiderStore.getState().getRiders(RACE);
    await second;
    const edited: RiderProps = { ...ofRace(RACE)[0], comment: "edited after load" };
    useRiderStore.setState((s) => ({ riders: s.riders.map((r) => (r.id === edited.id ? edited : r)) }));
    await first;
    expect(ofRace(RACE).find((r) => r.id === edited.id)?.comment).toBe("edited after load");
    expect(ofRace(RACE)).toHaveLength(2);
  });

  it("a local edit made while a load of its race is in flight is not overwritten", async () => {
    await useRiderStore.getState().getRiders(RACE);
    useRiderStore.setState({ lastFetchedRaceUuid: OTHER }); // force the next load to re-read
    const loading = useRiderStore.getState().getRiders(RACE);
    const edited: RiderProps = { ...ofRace(RACE)[0], lapsCounter: 3, comment: "lap while loading" };
    await useRiderStore.getState().updateRider(edited);
    await loading;
    expect(ofRace(RACE).find((r) => r.id === edited.id)?.comment).toBe("lap while loading");
    expect(ofRace(RACE).find((r) => r.id === edited.id)?.lapsCounter).toBe(3);
  });

  it("riders added, patched (synced) or deleted during a load keep that change", async () => {
    await useRiderStore.getState().getRiders(RACE);
    const [a, b] = ofRace(RACE);
    useRiderStore.setState({ lastFetchedRaceUuid: OTHER });
    const loading = useRiderStore.getState().getRiders(RACE);
    const added = makeRider({ category: "Elite", bibNumber: 13, raceUuid: RACE });
    const adding = useRiderStore.getState().addNewRider(added);
    const patching = useRiderStore.getState().patchRiders([{ ...a, status: "DNF" }]);
    const deleting = useRiderStore.getState().deleteRider(b.id);
    const result = await loading;
    await Promise.all([adding, patching, deleting]);
    const ids = ofRace(RACE).map((r) => r.id);
    expect(ids).toContain(added.id);
    expect(ids).not.toContain(b.id);
    expect(ofRace(RACE).find((r) => r.id === a.id)?.status).toBe("DNF");
    expect(result.map((r) => r.id).sort()).toEqual([...ids].sort());
  });

  it("a cache hit returns only the requested race's riders", async () => {
    await useRiderStore.getState().getRiders(OTHER);
    await useRiderStore.getState().getRiders(RACE);
    const got = await useRiderStore.getState().getRiders(RACE);
    expect(got.every((r) => r.raceUuid === RACE)).toBe(true);
    expect(got).toHaveLength(2);
  });
});
