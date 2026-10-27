import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

import RacePhaseSwitcher from "../RacePhaseSwitcher";
import useUIStore from "@/stores/uiStore";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/race/:id" element={<RacePhaseSwitcher />} />
        <Route path="/race/:id/heat/:heatId" element={<RacePhaseSwitcher compact />} />
        <Route path="/race/:id/results" element={<div data-testid="results-route" />} />
      </Routes>
    </MemoryRouter>
  );

describe("Results button in the phase header", () => {
  it.each([["race screen", "/race/r1", true], ["live screen", "/race/r1/heat/1", false]])(
    "is visible on the %s and opens the Results route",
    async (_n, path, raceMode) => {
      useUIStore.setState({ isRaceMode: raceMode });
      const user = userEvent.setup();
      renderAt(path);
      const btn = screen.getByTestId("results-btn");
      expect(btn).toBeVisible();
      await user.click(btn);
      expect(screen.getByTestId("results-route")).toBeInTheDocument();
    }
  );

  it("is not duplicated on the Create screen, which already has a Results tab", () => {
    useUIStore.setState({ isRaceMode: false });
    renderAt("/race/r1");
    expect(screen.queryByTestId("results-btn")).not.toBeInTheDocument();
  });

  it("is a single extra action: the three phase tabs are unchanged", () => {
    useUIStore.setState({ isRaceMode: true });
    renderAt("/race/r1");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Create", "Race", "Live"]);
    expect(screen.getAllByTestId("results-btn")).toHaveLength(1);
  });
});

describe("Results button: prominent, and shows when Results is the active screen", () => {
  const renderResults = () =>
    render(
      <MemoryRouter initialEntries={["/race/r1/results"]}>
        <Routes>
          <Route path="/race/:id/results" element={<RacePhaseSwitcher compact />} />
          <Route path="/race/:id/heat/:heatId" element={<div data-testid="live-route" />} />
        </Routes>
      </MemoryRouter>
    );

  it("on the Results screen: Results is current, no phase is selected, Live is one tap away", async () => {
    useUIStore.setState({ isRaceMode: true });
    const user = userEvent.setup();
    renderResults();
    const btn = screen.getByTestId("results-btn");
    expect(btn).toHaveAttribute("aria-current", "page");
    expect(btn.className).toMatch(/resultsActive/);
    expect(screen.getAllByRole("tab").every((t) => t.getAttribute("aria-selected") === "false")).toBe(true);
    await user.click(screen.getByRole("tab", { name: /Live/ }));
    expect(screen.getByTestId("live-route")).toBeInTheDocument();
  });

  it("elsewhere it is a solid blue action with a trophy and the label Results, not marked current", () => {
    useUIStore.setState({ isRaceMode: false });
    renderAt("/race/r1/heat/1");
    const btn = screen.getByTestId("results-btn");
    expect(btn).not.toHaveAttribute("aria-current");
    expect(btn.className).toMatch(/resultsBtn/);
    expect(btn).toHaveTextContent("Results");
    expect(btn.querySelector("svg")).not.toBeNull();
  });
});
