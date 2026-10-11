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
