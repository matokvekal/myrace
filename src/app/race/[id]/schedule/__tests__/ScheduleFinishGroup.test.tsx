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
import type { CategoryProps } from "@/types/types";

/** Finish Group dropdown (category.linkGroup): None by default, independent of the wave. */
const RACE = "race-1";
const groupOf = (id: number) => useCategoryStore.getState().categories.find((c) => c.id === id)?.linkGroup ?? "";

const setup = (cats: CategoryProps[]) => {
  useCategoryStore.setState({ categories: cats });
  useRiderStore.setState({ riders: [], lastFetchedRaceUuid: RACE });
  return render(
    <MemoryRouter>
      <Schedule raceUuid={RACE} categories={cats} />
    </MemoryRouter>
  );
};

describe("Schedule → Finish Group", () => {
  it("assigns categories in different waves to the same Finish Group, and Reset All clears every assignment", async () => {
    const user = userEvent.setup();
    const a = makeCategory({ id: 1, raceUuid: RACE, name: "Men Masters", heat: 1, startTime: "09:00", status: "upcoming" });
    const b = makeCategory({ id: 2, raceUuid: RACE, name: "Women Masters", heat: 2, startTime: "10:00", status: "upcoming" });
    setup([a, b]);
    // Finish Group is set on each schedule row; Reset All lives in Edit Schedule.
    const selA = screen.getByTestId("finish-group-row-1") as HTMLSelectElement;
    expect(selA.value).toBe(""); // None by default
    expect([...selA.options].map((o) => o.text)).toEqual(["None", "Finish Group 1", "Finish Group 2", "Finish Group 3"]);

    await user.selectOptions(selA, "1");
    await user.selectOptions(screen.getByTestId("finish-group-row-2"), "1");
    await waitFor(() => expect([groupOf(1), groupOf(2)]).toEqual(["1", "1"]));
    // The wave is untouched.
    expect(useCategoryStore.getState().categories.map((c) => c.heat)).toEqual([1, 2]);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: /Edit Schedule/ }));
    await user.click(screen.getByTestId("finish-group-reset-all"));
    await waitFor(() => expect([groupOf(1), groupOf(2)]).toEqual(["", ""]));
  });

  it("is fixed once the category has started", async () => {
    const user = userEvent.setup();
    const cat = makeCategory({ id: 3, raceUuid: RACE, name: "Elite", heat: 1, startTime: "09:00", status: "running", linkGroup: "2" });
    setup([cat]);
    const sel = screen.getByTestId("finish-group-row-3") as HTMLSelectElement;
    expect(sel.disabled).toBe(true);
    expect(sel.value).toBe("2");
  });
});
