import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/services/cloud/raceEvents", () => ({ recordRaceEvent: vi.fn().mockResolvedValue({}) }));
const warn = vi.fn();
vi.mock("react-toastify", () => ({ toast: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import EditRiders from "../EditRiders";
import useRiderStore from "@/stores/ridersStore";
import { makeRider } from "@/test/factories";
import { riderDeletionBlock } from "@/utils/riderDeletion";

/** Riders → Edit: Delete asks for confirmation with name and bib; riders with race activity are refused. */
const RACE = "race-1";
const ids = () => useRiderStore.getState().riders.map((r) => r.id);

beforeEach(() => warn.mockReset());

const setup = () => {
  const dana = makeRider({ id: 701, raceUuid: RACE, firstName: "Dana", lastName: "Levi", bibNumber: 42, category: "Elite" });
  const raced = makeRider({ id: 702, raceUuid: RACE, firstName: "Omer", lastName: "Katz", bibNumber: 7, category: "Elite", lapsCounter: 2, raceStatus: "running" });
  useRiderStore.setState({ riders: [dana, raced], lastFetchedRaceUuid: RACE });
  render(<EditRiders raceUuid={RACE} categories={[]} />);
  return { dana, raced };
};

describe("Edit Riders → Delete", () => {
  it("Cancel leaves the rider; Confirm deletes it, after showing the name and bib", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Delete Dana Levi (Bib 42)" }));
    const dialog = screen.getByRole("dialog", { name: "Delete rider?" });
    expect(within(dialog).getByText(/Dana Levi \(Bib 42\)/)).toBeTruthy();
    expect(within(dialog).queryByPlaceholderText("DELETE")).toBeNull(); // no typing for a single rider

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(ids()).toContain(701);

    await user.click(screen.getByRole("button", { name: "Delete Dana Levi (Bib 42)" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm Delete" }));
    await waitFor(() => expect(ids()).not.toContain(701));
    expect(ids()).toContain(702);
  });

  it("refuses to delete a rider with recorded laps, and explains why", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Delete Omer Katz (Bib 7)" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("already has recorded laps"));
    expect(ids()).toContain(702);
  });
});

describe("riderDeletionBlock", () => {
  it("allows riders without activity (also DNS), refuses laps, arrivals, DNF/DSQ and racing/finished", () => {
    const base = { lapsCounter: 0, lapsDetails: [], timeArrive: null, raceStatus: "upcoming" as const, status: "standing" as const };
    expect(riderDeletionBlock(base)).toBeNull();
    expect(riderDeletionBlock({ ...base, status: "DNS" })).toBeNull();
    expect(riderDeletionBlock({ ...base, lapsCounter: 1 })).toMatch(/laps/);
    expect(riderDeletionBlock({ ...base, timeArrive: "2026-01-01T10:00:00Z" })).toMatch(/passage/);
    expect(riderDeletionBlock({ ...base, status: "DSQ" })).toMatch(/DSQ/);
    expect(riderDeletionBlock({ ...base, raceStatus: "finished" })).toMatch(/finished/);
  });
});
