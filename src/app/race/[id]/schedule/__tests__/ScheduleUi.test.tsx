import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const recordRaceEvent = vi.fn().mockResolvedValue({});
vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: (...a: unknown[]) => recordRaceEvent(...a) }));

import Schedule from "../Schedule";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { makeCategory, makeRider } from "@/test/factories";
import type { CategoryProps, RiderProps } from "@/types/types";

const RACE = "race-1";
const upcoming = makeCategory({ name: "Elite", heat: 1, startTime: "09:00", status: "upcoming", color: "#112233" });
const finished = makeCategory({ name: "Juniors", heat: 2, startTime: "11:00", status: "finished", color: "#445566" });

const dana = makeRider({ category: "Elite", bibNumber: 10, firstName: "Dana", lastName: "Levi", team: "Club X" });
const omer = makeRider({ category: "Elite", bibNumber: 11, firstName: "Omer", lastName: "Cohen", status: "DNS" });

const setup = (cats: CategoryProps[] = [upcoming, finished], riders: RiderProps[] = [dana, omer]) => {
  useCategoryStore.setState({ categories: cats });
  useRiderStore.setState({ riders, lastFetchedRaceUuid: RACE });
  return render(
    <MemoryRouter>
      <Schedule raceUuid={RACE} categories={cats} />
    </MemoryRouter>
  );
};

const openElite = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByText("Elite"));
};

beforeEach(() => {
  recordRaceEvent.mockClear();
});

describe("Schedule: rider rows", () => {
  it("shows the full name and the status next to it, with no check-mark button", async () => {
    const user = userEvent.setup();
    setup();
    await openElite(user);
    expect(screen.getByRole("button", { name: /Dana Levi/ })).toBeInTheDocument();
    const omerBtn = screen.getByRole("button", { name: /Omer Cohen/ });
    expect(within(omerBtn).getByText("DNS")).toBeInTheDocument();
    expect(screen.queryByTitle("Check in")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Uncheck")).not.toBeInTheDocument();
  });

  it("clicking the name opens the details modal with every key field", async () => {
    const user = userEvent.setup();
    setup();
    await openElite(user);
    await user.click(screen.getByRole("button", { name: /Dana Levi/ }));
    expect(screen.getByTestId("rider-modal-status")).toHaveTextContent("Active");
    expect(screen.getByText("Club X")).toBeInTheDocument();
    expect(screen.getAllByText("#10").length).toBeGreaterThan(1); // list row + modal badge
    expect(screen.getByText("Bib #")).toBeInTheDocument();
    expect(screen.getByText("Wave")).toBeInTheDocument();
  });

  it("edits name, bib and status; the schedule updates immediately and it is persisted", async () => {
    const user = userEvent.setup();
    setup();
    await openElite(user);
    await user.click(screen.getByRole("button", { name: /Dana Levi/ }));
    await user.click(screen.getByRole("button", { name: /^Edit$/ }));

    const first = screen.getByPlaceholderText("First name");
    await user.clear(first);
    await user.type(first, "Dina");
    const bib = screen.getByDisplayValue("10");
    await user.clear(bib);
    await user.type(bib, "77");
    await user.selectOptions(screen.getByTestId("rider-modal-status-select"), "DNF");
    await user.click(screen.getByRole("button", { name: /Save/ }));

    // visible in the schedule right away
    const updated = await screen.findByRole("button", { name: /Dina Levi/ });
    expect(within(updated).getByText("DNF")).toBeInTheDocument();
    expect(screen.getAllByText("#77").length).toBeGreaterThan(0);

    // persisted to IndexedDB and logged
    await waitFor(async () => {
      const db = await initIndexedDB();
      const all = (await db.getAll("riders")) as RiderProps[];
      db.close();
      const row = all.find((r) => r.id === dana.id);
      expect(row).toMatchObject({ firstName: "Dina", bibNumber: 77, status: "DNF" });
    });
    expect(recordRaceEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "RIDER_EDITED", bibNumber: 77 }));
  });

  it("rejects a bib already used by another rider and saves nothing", async () => {
    const user = userEvent.setup();
    setup();
    await openElite(user);
    await user.click(screen.getByRole("button", { name: /Dana Levi/ }));
    await user.click(screen.getByRole("button", { name: /^Edit$/ }));
    const bib = screen.getByDisplayValue("10");
    await user.clear(bib);
    await user.type(bib, "11");
    await user.click(screen.getByRole("button", { name: /Save/ }));
    expect(screen.getByTestId("rider-modal-error")).toHaveTextContent(/already used/i);
    expect(useRiderStore.getState().riders.find((r) => r.id === dana.id)?.bibNumber).toBe(10);
  });
});

describe("Schedule: edit colour", () => {
  it("is disabled, with an explanation, for a finished category", () => {
    setup();
    const btn = screen.getByTestId(`edit-color-${finished.id}`);
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringMatching(/finished/i));
  });

  it("changes an unfinished category's colour, updates its riders and persists", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId(`edit-color-${upcoming.id}`));
    const input = screen.getByTestId("color-input") as HTMLInputElement;
    expect(input.value).toBe("#112233");
    // <input type=color> takes a value change, not typing
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "#ff8800" } });
    await user.click(screen.getByTestId("color-save"));

    await waitFor(() => {
      expect(useCategoryStore.getState().categories.find((c) => c.id === upcoming.id)?.color).toBe("#ff8800");
    });
    await waitFor(async () => {
      const db = await initIndexedDB();
      const cats = (await db.getAll("categories")) as CategoryProps[];
      const riders = (await db.getAll("riders")) as RiderProps[];
      db.close();
      expect(cats.find((c) => c.id === upcoming.id)?.color).toBe("#ff8800");
      expect(riders.find((r) => r.id === dana.id)?.color).toBe("#ff8800");
    });
    // timing and results are untouched
    const cat = useCategoryStore.getState().categories.find((c) => c.id === upcoming.id)!;
    expect(cat).toMatchObject({ startTime: "09:00", heat: 1, status: "upcoming" });
  });
});

describe("Edit schedule", () => {
  it("no longer shows a rider count next to each category", async () => {
    const user = userEvent.setup();
    setup([{ ...upcoming, riders: 12 }, finished]);
    await user.click(screen.getByRole("button", { name: /Edit Schedule/ }));
    expect(screen.queryByText(/12 riders/)).not.toBeInTheDocument();
    // the time nudge buttons (-5 / +5) are working controls, not stray data, and stay
    expect(screen.getAllByText("−5").length).toBeGreaterThan(0);
  });
});
