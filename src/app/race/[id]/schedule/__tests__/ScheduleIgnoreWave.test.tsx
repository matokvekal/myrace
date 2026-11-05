import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));

import Schedule from "../Schedule";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import { makeCategory, makeRider } from "@/test/factories";
import type { CategoryProps } from "@/types/types";
import { withoutIgnoredRiders, activeCategories } from "@/utils/ignoredWaves";

/** Ignore / Restore Wave: confirmed, visible, reversible, nothing deleted. */
const RACE = "race-1";
const ignoredOf = () => useCategoryStore.getState().categories.map((c) => !!c.ignored);
afterEach(() => vi.restoreAllMocks());

const setup = (cats: CategoryProps[]) => {
  useCategoryStore.setState({ categories: cats });
  const riders = [makeRider({ raceUuid: RACE, category: "Elite", heat: 1 }), makeRider({ raceUuid: RACE, category: "קטגוריה", heat: 9, bibNumber: 0 })];
  useRiderStore.setState({ riders, lastFetchedRaceUuid: RACE });
  // As in the race page: Schedule's categories follow the store.
  const Live = () => <Schedule raceUuid={RACE} categories={useCategoryStore((st) => st.categories)} />;
  render(
    <MemoryRouter>
      <Live />
    </MemoryRouter>
  );
  return riders;
};

describe("Schedule → Ignore / Restore Wave", () => {
  const cats = () => [
    makeCategory({ id: 1, raceUuid: RACE, name: "Elite", heat: 1, startTime: "09:00", status: "upcoming" }),
    makeCategory({ id: 9, raceUuid: RACE, name: "קטגוריה", heat: 9, startTime: "12:00", status: "upcoming" }),
  ];

  it("Cancel changes nothing; Confirm marks the wave Ignored; Restore brings it back; riders are kept", async () => {
    const user = userEvent.setup();
    const riders = setup(cats());
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    const ignoreBtn = screen.getAllByRole("button", { name: "Ignore Wave" }).at(-1)!;
    await user.click(ignoreBtn);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/1 category and 1 rider/));
    expect(ignoredOf()).toEqual([false, false]);

    confirm.mockReturnValueOnce(true);
    await user.click(screen.getAllByRole("button", { name: "Ignore Wave" }).at(-1)!);
    await waitFor(() => expect(ignoredOf()).toEqual([false, true]));
    expect(await screen.findByText("Ignored")).toBeInTheDocument();
    expect(useRiderStore.getState().riders).toHaveLength(2); // nothing deleted

    confirm.mockReturnValueOnce(true);
    await user.click(screen.getByRole("button", { name: "Restore Wave" }));
    await waitFor(() => expect(ignoredOf()).toEqual([false, false]));
    expect(riders).toHaveLength(2);
  });

  it("a running wave cannot be ignored", () => {
    setup([makeCategory({ id: 1, raceUuid: RACE, name: "Elite", heat: 1, startTime: "09:00", status: "running" })]);
    expect(screen.getByRole("button", { name: "Ignore Wave" })).toBeDisabled();
  });
});

describe("ignored waves leave race operations", () => {
  it("drops ignored categories and their riders, keeps the rest", () => {
    const all = [makeCategory({ raceUuid: RACE, name: "Elite", heat: 1 }), makeCategory({ raceUuid: RACE, name: "קטגוריה", heat: 9, ignored: true })];
    const riders = [makeRider({ raceUuid: RACE, category: "Elite" }), makeRider({ raceUuid: RACE, category: "קטגוריה" })];
    expect(activeCategories(all).map((c) => c.name)).toEqual(["Elite"]);
    expect(withoutIgnoredRiders(riders, all).map((r) => r.category)).toEqual(["Elite"]);
    expect(withoutIgnoredRiders(riders, all.map((c) => ({ ...c, ignored: false })))).toHaveLength(2);
  });
});
