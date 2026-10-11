import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));

import Categories from "../Categories";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { makeCategory, makeRider } from "@/test/factories";
import type { CategoryProps, RiderProps } from "@/types/types";

const RACE = "race-1";

const setup = (cat: CategoryProps, riders: RiderProps[] = [makeRider({ category: cat.name })]) => {
  useCategoryStore.setState({ categories: [cat] });
  useRiderStore.setState({ riders, lastFetchedRaceUuid: RACE });
  return render(<Categories raceUuid={RACE} />);
};

const startEdit = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByTitle(`Edit ${name}`));
};

beforeEach(() => {
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

describe("Category edit form", () => {
  it("shows only the selected colour until clicked; picking a colour closes the palette", async () => {
    const user = userEvent.setup();
    setup(makeCategory({ name: "Elite", status: "upcoming", color: "#63A6FC", laps: 4, heat: 2, startTime: "09:30" }));
    await startEdit(user, "Elite");

    expect(screen.getByTestId("category-color-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("category-color-palette")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("category-color-trigger"));
    const palette = screen.getByTestId("category-color-palette");
    const swatches = palette.querySelectorAll("button");
    expect(swatches.length).toBeGreaterThan(3);
    await user.click(swatches[1]);
    expect(screen.queryByTestId("category-color-palette")).not.toBeInTheDocument();
  });

  it("shows current wave, start time and laps, and saves their changes", async () => {
    const user = userEvent.setup();
    const cat = makeCategory({ name: "Elite", status: "upcoming", laps: 4, heat: 2, startTime: "09:30" });
    setup(cat);
    await startEdit(user, "Elite");

    expect(screen.getByDisplayValue("09:30")).toBeEnabled();
    expect(screen.getByDisplayValue("4")).toBeEnabled();
    // (the wave input snaps an empty value back to 1, so set it in one change)
    fireEvent.change(screen.getByDisplayValue("2"), { target: { value: "3" } });
    fireEvent.change(screen.getByDisplayValue("4"), { target: { value: "6" } });
    await user.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(async () => {
      const db = await initIndexedDB();
      const stored = ((await db.getAll("categories")) as CategoryProps[]).find((c) => c.id === cat.id);
      db.close();
      expect(stored).toMatchObject({ heat: 3, laps: 6, startTime: "09:30" });
    });
  });

  it("locks wave and start time for a started category and refuses fewer laps than ridden", async () => {
    const user = userEvent.setup();
    const cat = makeCategory({ name: "Elite", status: "running", laps: 5, heat: 1, startTime: "09:00" });
    setup(cat, [makeRider({ category: "Elite", lapsCounter: 3, raceStatus: "running" })]);
    await startEdit(user, "Elite");

    expect(screen.getByTestId("category-lock-note")).toHaveTextContent(/started/i);
    expect(screen.getByTestId("category-start-time")).toBeDisabled();
    expect(screen.getByDisplayValue("1")).toBeDisabled(); // wave

    const laps = screen.getByDisplayValue("5");
    await user.clear(laps);
    await user.type(laps, "2");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(screen.getByTestId("category-edit-error")).toHaveTextContent(/fewer than 3/);
    expect(useCategoryStore.getState().categories[0].laps).toBe(5);
  });

  it("locks everything for a finished category", async () => {
    const user = userEvent.setup();
    setup(makeCategory({ name: "Elite", status: "finished", laps: 5 }));
    await startEdit(user, "Elite");
    expect(screen.getByTestId("category-lock-note")).toHaveTextContent(/finished/i);
    expect(screen.getByTestId("category-color-trigger")).toBeDisabled();
    expect(screen.getByTestId("category-start-time")).toBeDisabled();
    expect(screen.getByDisplayValue("5")).toBeDisabled();
  });
});
