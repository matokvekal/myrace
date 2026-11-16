/**
 * Hotfix (1.2.1-rc.5): opening a race by its link showed an EMPTY RACE screen until a refresh
 * or another tab. RaceMode never loaded the race's riders itself; it used whatever the rider
 * store held: another race's riders (app still alive in the background) or nothing (start-up
 * hydration failed). It now loads them on mount, like Check-In / Board / Live / Results.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import RaceMode from "../RaceMode";
import useRiderStore from "@/stores/ridersStore";
import useRaceStore from "@/stores/racesStore";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { makeCategory, makeRider } from "@/test/factories";

const RACE = "race-open-by-link";
const OTHER = "race-seen-before";
const cats = [makeCategory({ name: "Elite", heat: 1, startTime: "09:00", status: "running", laps: 3, raceUuid: RACE })];
const mine = [1, 2, 3].map((b) => makeRider({ category: "Elite", bibNumber: b, raceUuid: RACE, raceStatus: "running", timeStartRace: new Date().toISOString() }));
const others = [makeRider({ category: "Elite", bibNumber: 99, raceUuid: OTHER })];

const ridersOfRace = () => useRiderStore.getState().riders.filter((r) => r.raceUuid === RACE);

beforeEach(async () => {
  Element.prototype.scrollTo = vi.fn() as never; // jsdom has no scrolling
  Element.prototype.scrollIntoView = vi.fn();
  const db = await initIndexedDB();
  await db.clear("riders");
  for (const r of [...mine, ...others]) await db.put("riders", r);
  db.close();
  useRaceStore.setState({ races: [{ id: 1, uuid: RACE, name: "Spring Cup", date: "2026-11-16" } as never] });
});

const open = () =>
  render(
    <MemoryRouter>
      <RaceMode raceUuid={RACE} categories={cats} />
    </MemoryRouter>,
  );

describe("RACE screen loads its own riders (direct link)", () => {
  it("app alive with ANOTHER race's riders in memory → this race's riders are loaded", async () => {
    useRiderStore.setState({ riders: others, lastFetchedRaceUuid: OTHER });
    open();
    await waitFor(() => expect(ridersOfRace().map((r) => r.bibNumber).sort()).toEqual([1, 2, 3]));
  });

  it("start-up hydration left the store empty → this race's riders are loaded", async () => {
    useRiderStore.setState({ riders: [], lastFetchedRaceUuid: null as never });
    open();
    await waitFor(() => expect(ridersOfRace()).toHaveLength(3));
  });

  it("this race already loaded → kept as is (no re-read over newer in-memory data)", async () => {
    const newer = mine.map((r) => ({ ...r, lapsCounter: 2 }));
    useRiderStore.setState({ riders: newer, lastFetchedRaceUuid: RACE });
    open();
    await new Promise((r) => setTimeout(r, 50));
    expect(ridersOfRace().every((r) => r.lapsCounter === 2)).toBe(true);
  });
});
