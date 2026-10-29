import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));

import Riders from "../Riders";
import useRiderStore from "@/stores/ridersStore";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { makeCategory, makeRider } from "@/test/factories";
import type { RiderProps } from "@/types/types";

const RACE = "race-1";
const elite = makeCategory({ name: "Elite", heat: 1, startTime: "09:00" });
const masters = makeCategory({ name: "Masters", heat: 1, startTime: "09:00" });
const juniors = makeCategory({ name: "Juniors", heat: 2, startTime: "11:00" });
const cats = [juniors, elite, masters];

const riders = [
  makeRider({ category: "Juniors", bibNumber: 31, firstName: "Noa", lastName: "Bar" }),
  makeRider({ category: "Elite", bibNumber: 11, firstName: "Dana", lastName: "Levi" }),
  makeRider({ category: "Masters", bibNumber: 21, firstName: "Yossi", lastName: "Mizrahi" }),
  makeRider({ category: "Elite", bibNumber: 12, firstName: "Avi", lastName: "Cohen" }),
];

const setup = () => {
  useRiderStore.setState({ riders, lastFetchedRaceUuid: RACE });
  return render(<Riders raceUuid={RACE} categories={cats} />);
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("Riders: Wave → Category → Riders", () => {
  it("groups riders under their wave, then category, in schedule order", () => {
    setup();
    const w1 = screen.getByTestId("wave-group-1");
    const w2 = screen.getByTestId("wave-group-2");
    expect(w1.compareDocumentPosition(w2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const heads1 = within(w1).getAllByTestId("rider-category-header").map((h) => h.textContent);
    expect(heads1[0]).toMatch(/Elite/);
    expect(heads1[1]).toMatch(/Masters/);
    expect(within(w2).getByTestId("rider-category-header")).toHaveTextContent("Juniors");
    expect(within(w1).getByText(/Levi Dana/)).toBeInTheDocument();
    expect(within(w1).queryByText(/Bar Noa/)).not.toBeInTheDocument();
  });
});

describe("Riders: search", () => {
  it("finds across all waves by first/last/full name or bib, case-insensitive and partial", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("rider-tools-toggle")); // search sits behind the search icon
    const box = screen.getByTestId("rider-search");

    await user.type(box, "dan");
    expect(screen.getByText(/Levi Dana/)).toBeInTheDocument();
    expect(screen.queryByText(/Cohen Avi/)).not.toBeInTheDocument();

    await user.clear(box);
    await user.type(box, "BAR");
    expect(screen.getByText(/Bar Noa/)).toBeInTheDocument(); // wave 2, found while wave filter is "all"

    await user.clear(box);
    await user.type(box, "21");
    expect(screen.getByText(/Mizrahi Yossi/)).toBeInTheDocument();
    expect(screen.queryByText(/Levi Dana/)).not.toBeInTheDocument();

    await user.clear(box);
    await user.type(box, "avi cohen");
    expect(screen.getByText(/Cohen Avi/)).toBeInTheDocument();
  });
});

describe("Riders: Add Rider", () => {
  it("opens the add form from a category header, validates the bib, and adds the rider to that category", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByTestId("add-rider-Juniors")); // "+" on the Juniors header
    expect(within(screen.getByTestId("add-rider-modal")).queryByRole("combobox")).toBeNull(); // category preset
    const modal = screen.getByTestId("add-rider-modal");

    // duplicate bib is refused by the shared validation
    await user.type(within(modal).getByPlaceholderText("First name *"), "Lior");
    await user.type(within(modal).getByPlaceholderText("Last name *"), "Katz");
    await user.type(within(modal).getByPlaceholderText("Bib # *"), "11");
    await user.click(within(modal).getByRole("button", { name: "Add Rider" }));
    expect(within(modal).getByText(/already used/i)).toBeInTheDocument();

    const bib = within(modal).getByPlaceholderText("Bib # *");
    await user.clear(bib);
    await user.type(bib, "99");
    await user.click(within(modal).getByRole("button", { name: "Add Rider" }));

    await waitFor(() => expect(screen.queryByTestId("add-rider-modal")).not.toBeInTheDocument());
    const w2 = screen.getByTestId("wave-group-2");
    expect(within(w2).getByText(/Katz Lior/)).toBeInTheDocument();

    await waitFor(async () => {
      const db = await initIndexedDB();
      const all = (await db.getAll("riders")) as RiderProps[];
      db.close();
      expect(all.find((r) => r.bibNumber === 99)).toMatchObject({ category: "Juniors", heat: 2 });
    });
  });

  it("is hidden on a read-only (finalized) race", () => {
    useRiderStore.setState({ riders, lastFetchedRaceUuid: RACE });
    render(<Riders raceUuid={RACE} categories={cats} readOnly />);
    expect(screen.queryByTestId("add-rider-btn")).not.toBeInTheDocument();
  });
});
