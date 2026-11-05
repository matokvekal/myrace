import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));

import Categories from "../Categories";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import { makeCategory, makeRider } from "@/test/factories";
import type { CategoryProps, RiderProps } from "@/types/types";

/**
 * Story 1.6 — the Categories ± lap stepper used to skip the category locks that
 * the edit dialog enforces: laps could drop below what riders already rode, and
 * a finished category's laps could still change.
 */

const RACE = "race-1";

const setup = (cat: CategoryProps, riders: RiderProps[]) => {
  useCategoryStore.setState({ categories: [cat] });
  useRiderStore.setState({ riders, lapsFetchedRaceUuid: RACE, lastFetchedRaceUuid: RACE } as any);
  return render(<Categories raceUuid={RACE} />);
};

const lapsOf = (id: number) => useCategoryStore.getState().categories.find((c) => c.id === id)?.laps;
const minus = () => screen.getAllByRole("button", { name: /^Fewer laps/ })[0];
const plus = () => screen.getAllByRole("button", { name: /^More laps/ })[0];

beforeEach(() => {
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

describe("Categories lap stepper respects the category locks", () => {
  it("cannot drop a running category below the laps a rider already rode", async () => {
    const user = userEvent.setup();
    const cat = makeCategory({ name: "Elite", status: "running", laps: 4 });
    setup(cat, [makeRider({ category: "Elite", raceUuid: RACE, lapsCounter: 4 })]);

    await user.click(minus());
    await new Promise((r) => setTimeout(r, 50));
    expect(lapsOf(cat.id)).toBe(4);

    await user.click(plus());
    await waitFor(() => expect(lapsOf(cat.id)).toBe(5));
  });

  it("cannot change the laps of a finished category", async () => {
    const user = userEvent.setup();
    const cat = makeCategory({ name: "Elite", status: "finished", laps: 4 });
    setup(cat, [makeRider({ category: "Elite", raceUuid: RACE, lapsCounter: 2 })]);

    await user.click(plus());
    await user.click(minus());
    await new Promise((r) => setTimeout(r, 50));
    expect(lapsOf(cat.id)).toBe(4);
  });

  it("still lets an upcoming category go down (unchanged behaviour)", async () => {
    const user = userEvent.setup();
    const cat = makeCategory({ name: "Elite", status: "upcoming", laps: 4 });
    setup(cat, [makeRider({ category: "Elite", raceUuid: RACE, lapsCounter: 0 })]);

    await user.click(minus());
    await waitFor(() => expect(lapsOf(cat.id)).toBe(3));
  });
});
