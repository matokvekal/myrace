import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));

import Schedule from "../Schedule";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import { makeCategory } from "@/test/factories";

/** Finish Group right on each Schedule category row, and one colour for a whole Finish Group. */
const RACE = "race-1";
const cat = (id: number) => useCategoryStore.getState().categories.find((c) => c.id === id)!;

describe("Schedule rows → Finish Group and group colour", () => {
  it("assigns categories of different waves to Finish Group 1 from their rows, then colours the whole group", async () => {
    const user = userEvent.setup();
    useCategoryStore.setState({
      categories: [
        makeCategory({ id: 1, raceUuid: RACE, name: "Men Level 2", subCategory: null, heat: 1, startTime: "09:00", status: "upcoming", color: "#E53935" }),
        makeCategory({ id: 2, raceUuid: RACE, name: "Women Level 2", subCategory: null, heat: 2, startTime: "10:00", status: "upcoming", color: "#43A047" }),
        makeCategory({ id: 3, raceUuid: RACE, name: "Elite", subCategory: null, heat: 1, startTime: "09:00", status: "upcoming", color: "#FB8C00" }),
      ],
    });
    useRiderStore.setState({ riders: [], lastFetchedRaceUuid: RACE });
    const Live = () => <Schedule raceUuid={RACE} categories={useCategoryStore((s) => s.categories)} />;
    render(<MemoryRouter><Live /></MemoryRouter>);

    await user.selectOptions(screen.getByTestId("finish-group-row-1"), "1");
    await user.selectOptions(screen.getByTestId("finish-group-row-2"), "1");
    await waitFor(() => expect([cat(1).linkGroup, cat(2).linkGroup, cat(3).linkGroup ?? ""]).toEqual(["1", "1", ""]));
    expect([cat(1).heat, cat(2).heat]).toEqual([1, 2]); // waves untouched

    await user.click(screen.getByTestId("edit-color-1"));
    await user.click(screen.getByTestId("color-whole-finish-group"));
    await user.click(screen.getByTestId("swatch-1E88E5"));
    await waitFor(() => expect([cat(1).color, cat(2).color, cat(3).color]).toEqual(["#1E88E5", "#1E88E5", "#FB8C00"]));
  });
});
