import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));

import ResultsPage from "../ResultsPage";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import useRaceStore from "@/stores/racesStore";
import { makeCategory, makeRider } from "@/test/factories";

const RACE = "race-1";
const START = "08:00:00";
const finish = (min: number) => new Date(new Date().setHours(8, min, 0, 0)).toISOString();

const elite = makeCategory({ name: "Elite", heat: 1, startTime: "08:00", laps: 3, color: "#e74c3c" });
const juniors = makeCategory({ name: "Juniors", heat: 2, startTime: "09:00", laps: 3, color: "#2980b9" });

const base = { raceStatus: "finished" as const, timeStartRace: START, totalLaps: 3, lapsCounter: 3 };
const riders = () => [
  makeRider({ ...base, category: "Elite", bibNumber: 2, firstName: "Bea", lastName: "Second", timeArrive: finish(50) }),
  makeRider({ ...base, category: "Elite", bibNumber: 1, firstName: "Ann", lastName: "First", timeArrive: finish(40) }),
  makeRider({ category: "Elite", bibNumber: 3, firstName: "Cid", lastName: "Dnf", status: "DNF", lapsCounter: 1, totalLaps: 3 }),
  makeRider({ category: "Elite", bibNumber: 4, firstName: "Dee", lastName: "Dns", status: "DNS", lapsCounter: 0, totalLaps: 3 }),
  makeRider({ category: "Elite", bibNumber: 5, firstName: "Eve", lastName: "Dsq", status: "DSQ", lapsCounter: 3, totalLaps: 3 }),
  makeRider({ ...base, category: "Juniors", bibNumber: 9, firstName: "Jon", lastName: "Junior", timeArrive: finish(45) }),
];

const renderPage = (initial = [`/race/${RACE}/heat/1`, `/race/${RACE}/results`]) =>
  render(
    <MemoryRouter initialEntries={initial} initialIndex={initial.length - 1}>
      <Routes>
        <Route path="/race/:id/results" element={<ResultsPage />} />
        <Route path="/race/:id/heat/:heatId" element={<div data-testid="live-screen" />} />
        <Route path="/race/:id" element={<div data-testid="race-screen" />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useRaceStore.setState({ races: [{ id: 1, uuid: RACE, name: "Test Race", status: "running" } as any] });
  useCategoryStore.setState({ categories: [elite, juniors] });
  useRiderStore.setState({ riders: riders(), lastFetchedRaceUuid: RACE });
});

describe("Results screen", () => {
  it("groups by Wave then Category, with rank, bib, name, laps, time and status", () => {
    renderPage();
    const waves = screen.getAllByText(/^Wave \d$/).map((e) => e.textContent);
    expect(waves.slice(0, 2)).toEqual(["Wave 1", "Wave 2"]);
    const blocks = screen.getAllByTestId("results-category");
    expect(blocks).toHaveLength(2);
    const eliteRows = within(blocks[0]).getAllByText(/^#\d$/).map((e) => e.textContent);
    expect(eliteRows.slice(0, 2)).toEqual(["#1", "#2"]); // ranked by place: Ann (40 min) before Bea (50 min)
    expect(within(blocks[0]).getByText("First Ann")).toBeInTheDocument();
    expect(within(blocks[0]).getAllByText("3/3").length).toBeGreaterThan(0);
    expect(within(blocks[0]).getByText("00:40:00")).toBeInTheDocument();
  });

  it("lists DNF / DNS / DSQ after the ranked finishers, under a separate divider, without a position", () => {
    renderPage();
    const elite = screen.getAllByTestId("results-category")[0];
    const text = elite.textContent ?? "";
    const divider = within(elite).getByTestId("results-out-divider");
    expect(divider).toHaveTextContent(/not classified/i);
    // ranked riders come first, out riders after the divider
    expect(text.indexOf("Bea")).toBeLessThan(text.indexOf("Not classified"));
    for (const n of ["Dnf", "Dns", "Dsq"]) expect(text.indexOf("Not classified")).toBeLessThan(text.indexOf(n));
    // positions 1 and 2 only belong to ranked riders; out riders show a dash
    const dnfRow = within(elite).getByText("Dnf Cid").closest("div")!;
    expect(dnfRow).toHaveTextContent("—");
    expect(dnfRow).toHaveTextContent("DNF");
  });

  it("category chips jump to a category without leaving the screen", async () => {
    const user = userEvent.setup();
    renderPage();
    const chips = screen.getAllByTestId("results-cat-chip");
    expect(chips.map((c) => c.textContent)).toEqual(["Elite", "Juniors"]);
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    await user.click(chips[1]);
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(screen.getByTestId("race-mode-indicator")).toHaveAttribute("data-mode", "results");
  });

  it("updates when race data changes", async () => {
    renderPage();
    expect(screen.queryByText("Late Zed")).not.toBeInTheDocument();
    act(() => {
      useRiderStore.setState({
        riders: [...riders(), makeRider({ ...base, category: "Juniors", bibNumber: 77, firstName: "Zed", lastName: "Late", timeArrive: finish(55) })],
      });
    });
    expect(await screen.findByText("Late Zed")).toBeInTheDocument();
  });

  it("the race sidebar marks Results current and opens Live", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId("race-menu-btn"));
    expect(screen.getByTestId("race-nav-results")).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByTestId("race-nav-live"));
    expect(screen.getByTestId("live-screen")).toBeInTheDocument();
  });

  it("the race sidebar returns to the Create screen", async () => {
    const user = userEvent.setup();
    renderPage([`/race/${RACE}/results`]);
    await user.click(screen.getByTestId("race-menu-btn"));
    await user.click(screen.getByTestId("race-nav-setup"));
    expect(screen.getByTestId("race-screen")).toBeInTheDocument();
  });
});
