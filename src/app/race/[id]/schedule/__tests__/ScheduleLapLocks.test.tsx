import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));

import Schedule from "../Schedule";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import { makeCategory, makeRider } from "@/test/factories";
import type { CategoryProps, RiderProps } from "@/types/types";

/**
 * Story 1.6 — Schedule's "Edit Laps" ± used to skip the category locks: laps
 * could drop below what riders already rode, and a finished category could
 * still change. Status toggles there also set inconsistent raceStatus (BUG-05).
 */

const RACE = "race-1";

const setup = (cats: CategoryProps[], riders: RiderProps[]) => {
  useCategoryStore.setState({ categories: cats });
  useRiderStore.setState({ riders, lastFetchedRaceUuid: RACE });
  return render(
    <MemoryRouter>
      <Schedule raceUuid={RACE} categories={cats} />
    </MemoryRouter>
  );
};

const lapsOf = (id: number) => useCategoryStore.getState().categories.find((c) => c.id === id)?.laps;
const riderById = (id: number) => useRiderStore.getState().riders.find((r) => r.id === id)!;

describe("Schedule lap editing respects the category locks", () => {
  it("refuses to go below laps already ridden, but can still go up", async () => {
    const user = userEvent.setup();
    const cat = makeCategory({ name: "Elite", heat: 1, startTime: "09:00", status: "running", laps: 3 });
    setup([cat], [makeRider({ category: "Elite", raceUuid: RACE, lapsCounter: 3, raceStatus: "running" })]);

    await user.click(screen.getByRole("button", { name: /Edit Laps/ }));
    await user.click(screen.getByRole("button", { name: "−" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(lapsOf(cat.id)).toBe(3);

    await user.click(screen.getByRole("button", { name: "+" }));
    await waitFor(() => expect(lapsOf(cat.id)).toBe(4));
  });

  it("does not change a finished category's laps", async () => {
    const user = userEvent.setup();
    const cat = makeCategory({ name: "Elite", heat: 1, startTime: "09:00", status: "finished", laps: 3 });
    setup([cat], [makeRider({ category: "Elite", raceUuid: RACE, lapsCounter: 1, raceStatus: "finished" })]);

    await user.click(screen.getByRole("button", { name: /Edit Laps/ }));
    await user.click(screen.getByRole("button", { name: "+" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(lapsOf(cat.id)).toBe(3);
  });
});

describe("Schedule status toggles keep raceStatus consistent (BUG-05)", () => {
  it("DNF on a racing rider takes them off course; clearing puts them back racing with laps intact", async () => {
    const user = userEvent.setup();
    const cat = makeCategory({ name: "Elite", heat: 1, startTime: "09:00", status: "running", laps: 5 });
    const rider = makeRider({ id: 501, category: "Elite", raceUuid: RACE, bibNumber: 21, lapsCounter: 2, raceStatus: "running", timeStartRace: "09:00:00", totalLaps: 5 });
    setup([cat], [rider]);

    await user.click(screen.getByText("Elite"));
    await user.click(screen.getByRole("button", { name: "DNF" }));
    await waitFor(() => expect(riderById(501)).toMatchObject({ status: "DNF", raceStatus: "finished", lapsCounter: 2 }));

    await user.click(screen.getByRole("button", { name: "DNF" }));
    await waitFor(() => expect(riderById(501)).toMatchObject({ status: "standing", raceStatus: "running", lapsCounter: 2 }));
  });

  it("DSQ off returns to standing (not a forced 'running' status)", async () => {
    const user = userEvent.setup();
    const cat = makeCategory({ name: "Elite", heat: 1, startTime: "09:00", status: "upcoming", laps: 5 });
    const rider = makeRider({ id: 502, category: "Elite", raceUuid: RACE, bibNumber: 22, lapsCounter: 0, raceStatus: "upcoming", timeStartRace: null, totalLaps: 5 });
    setup([cat], [rider]);

    await user.click(screen.getByText("Elite"));
    await user.click(screen.getByRole("button", { name: "DSQ" }));
    await waitFor(() => expect(riderById(502)).toMatchObject({ status: "DSQ", raceStatus: "upcoming" }));
    await user.click(screen.getByRole("button", { name: "DSQ" }));
    await waitFor(() => expect(riderById(502)).toMatchObject({ status: "standing", raceStatus: "upcoming" }));
  });
});
