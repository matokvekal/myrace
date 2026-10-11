import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import LiveBoard from "../LiveBoard";
import useRiderStore from "@/stores/ridersStore";
import { makeCategory, makeRider } from "@/test/factories";

const RACE = "race-1";
const w1a = makeCategory({ name: "Elite", heat: 1, startTime: "09:00", status: "running", laps: 3 });
const w1b = makeCategory({ name: "Masters", heat: 1, startTime: "09:00", status: "upcoming", laps: 3 });
const w2 = makeCategory({ name: "Juniors", heat: 2, startTime: "11:00", status: "upcoming", laps: 3 });
const cats = [w1a, w1b, w2];

const riders = [
  makeRider({ category: "Elite", bibNumber: 1, firstName: "Ann", lastName: "A", raceStatus: "running", lapsCounter: 2, timeStartRace: new Date().toISOString() }),
  makeRider({ category: "Elite", bibNumber: 2, firstName: "Bob", lastName: "B", raceStatus: "running", lapsCounter: 1, timeStartRace: new Date().toISOString() }),
  makeRider({ category: "Elite", bibNumber: 3, firstName: "Cid", lastName: "C", raceStatus: "finished", status: "DNF", lapsCounter: 1 }),
  makeRider({ category: "Masters", bibNumber: 4 }),
  makeRider({ category: "Juniors", bibNumber: 5 }),
];

const renderBoard = (waveNum = 1) => render(<LiveBoard raceUuid={RACE} waveNum={waveNum} categories={cats} />);

beforeEach(() => {
  useRiderStore.setState({ riders, lastFetchedRaceUuid: RACE });
  // jsdom has no scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
});

describe("Board: always the complete board", () => {
  it("shows every wave and every category regardless of the selected wave", () => {
    renderBoard(1);
    expect(screen.getByTestId("board-wave-1")).toBeInTheDocument();
    expect(screen.getByTestId("board-wave-2")).toBeInTheDocument();
    for (const n of ["Elite", "Masters", "Juniors"]) expect(screen.getAllByText(n).length).toBeGreaterThan(0);
  });

  it("selecting a wave scrolls to it and hides nothing", () => {
    const { rerender } = renderBoard(1);
    const scroll = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scroll.mockClear();
    rerender(<LiveBoard raceUuid={RACE} waveNum={2} categories={cats} />);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.instances[0]).toBe(document.getElementById("board-wave-2"));
    expect(screen.getByTestId("board-wave-1")).toBeInTheDocument();
    expect(screen.getByTestId("board-wave-2")).toBeInTheDocument();
  });
});

describe("Board: expandable category results", () => {
  it("+ expands the full list with positions, DNF without one; clicking again collapses", async () => {
    const user = userEvent.setup();
    renderBoard();
    const btn = screen.getByTestId(`board-expand-${w1a.id}`);
    expect(screen.queryByTestId(`board-results-${w1a.id}`)).not.toBeInTheDocument();

    await user.click(btn);
    const list = screen.getByTestId(`board-results-${w1a.id}`);
    const rows = within(list).getAllByTestId("board-result-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("P1");
    expect(rows[0]).toHaveTextContent("#1");
    expect(rows[1]).toHaveTextContent("P2");
    // DNF is listed, labelled, and has NO finishing position
    expect(rows[2]).toHaveTextContent("#3");
    expect(rows[2]).toHaveTextContent("DNF");
    expect(rows[2]).not.toHaveTextContent(/P\d/);

    await user.click(btn);
    expect(screen.queryByTestId(`board-results-${w1a.id}`)).not.toBeInTheDocument();
  });
});
