import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));
const saved: unknown[] = [];
vi.mock("@/services/finishGroupPrefs", async () => {
  const { learnRace, emptyPrefs } = await import("@/utils/finishGroupLearning");
  const { makeCategory } = await import("@/test/factories");
  const prefs = learnRace(emptyPrefs(), "past", [
    makeCategory({ id: 1, name: "Men Masters", linkGroup: "1" }),
    makeCategory({ id: 2, name: "Women Masters", linkGroup: "1" }),
  ]);
  // Plain functions: the test config resets vi.fn implementations between tests.
  return { loadFinishGroupPrefs: async () => prefs, saveFinishGroupPrefs: async (p: unknown) => void saved.push(p) };
});

import Schedule from "../Schedule";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import { makeCategory } from "@/test/factories";

const RACE = "race-1";
const groupOf = (id: number) => useCategoryStore.getState().categories.find((c) => c.id === id)?.linkGroup ?? "";

describe("Schedule → suggested Finish Groups", () => {
  it("shows suggestions in the dropdowns (marked Suggested), Accept saves them; Reset All keeps learned preferences", async () => {
    const user = userEvent.setup();
    const cats = [
      makeCategory({ id: 11, raceUuid: RACE, name: "Men Masters", heat: 1, startTime: "09:00", status: "upcoming" }),
      makeCategory({ id: 12, raceUuid: RACE, name: "Women Masters", heat: 2, startTime: "10:00", status: "upcoming" }),
    ];
    useCategoryStore.setState({ categories: cats });
    useRiderStore.setState({ riders: [], lastFetchedRaceUuid: RACE });
    const Live = () => <Schedule raceUuid={RACE} categories={useCategoryStore((s) => s.categories)} />;
    render(<MemoryRouter><Live /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: /Edit Schedule/ }));

    expect(await screen.findByTestId("finish-group-suggested-11")).toHaveTextContent("Suggested");
    expect((screen.getByTestId("finish-group-12") as HTMLSelectElement).value).toBe("1");
    expect([groupOf(11), groupOf(12)]).toEqual(["", ""]); // not saved until accepted

    await user.click(screen.getByTestId("finish-group-accept"));
    await waitFor(() => expect([groupOf(11), groupOf(12)]).toEqual(["1", "1"]));
    await waitFor(() => expect(saved.length).toBe(1)); // learned from the accepted assignment

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByTestId("finish-group-reset-all"));
    await waitFor(() => expect([groupOf(11), groupOf(12)]).toEqual(["", ""]));
    expect(saved.length).toBe(1); // Reset All does not touch learned preferences
  });
});
