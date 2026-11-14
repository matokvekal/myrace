/**
 * Live UI fixes:
 *  - Find a rider: read-only look-up over the whole race (every wave), never records a lap.
 *  - Double-tap status menu: DSQ · DNS · DNF, DNF on the right.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import RiderLookupModal, { lookupStatus } from "../RiderLookupModal";
import RiderLiveModal from "../RiderLiveModal";
import { makeCategory, makeRider } from "@/test/factories";

const cats = [
  makeCategory({ name: "Masters 40", heat: 1, status: "running", laps: 4, color: "#ff0000" }),
  makeCategory({ name: "Masters 50", heat: 2, status: "upcoming", laps: 3, color: "#0000ff", startTime: "10:00" }),
];
const riders = [
  makeRider({ bibNumber: 150, firstName: "Avi", lastName: "Cohen", category: "Masters 40", raceStatus: "running", lapsCounter: 2 }),
  makeRider({ bibNumber: 15, firstName: "Dana", lastName: "Levi", category: "Masters 40", status: "DNF", raceStatus: "finished" }),
  makeRider({ bibNumber: 1500, firstName: "Ron", lastName: "Bar", category: "Masters 50", heat: 2 }),
  makeRider({ bibNumber: 7, firstName: "Noa", lastName: "Shani", category: "Masters 50", heat: 2 }),
];

describe("Find a rider (Live, read-only)", () => {
  it("lists every rider of the race, across waves, with bib, name, category, wave and status", () => {
    render(<RiderLookupModal riders={riders} categories={cats} onClose={() => {}} />);
    const rows = screen.getAllByTestId("rider-lookup-row");
    expect(rows).toHaveLength(4);
    const avi = rows.find((r) => r.getAttribute("data-bib") === "150")!;
    expect(avi).toHaveTextContent("Avi Cohen");
    expect(avi).toHaveTextContent("Masters 40 · Wave 1");
    expect(avi).toHaveTextContent("RUNNING · lap 2/4");
    const ron = rows.find((r) => r.getAttribute("data-bib") === "1500")!;
    expect(ron).toHaveTextContent("Masters 50 · Wave 2");
    expect(ron).toHaveTextContent("NOT STARTED");
    expect(rows.find((r) => r.getAttribute("data-bib") === "15")!).toHaveTextContent("DNF");
  });

  it("a typed bib puts the exact bib first, then bibs starting with it; names search too", () => {
    render(<RiderLookupModal riders={riders} categories={cats} onClose={() => {}} />);
    const input = screen.getByTestId("rider-lookup-input");
    fireEvent.change(input, { target: { value: "150" } });
    expect(screen.getAllByTestId("rider-lookup-row").map((r) => r.getAttribute("data-bib"))).toEqual(["150", "1500"]);
    fireEvent.change(input, { target: { value: "noa" } });
    expect(screen.getAllByTestId("rider-lookup-row").map((r) => r.getAttribute("data-bib"))).toEqual(["7"]);
    fireEvent.change(input, { target: { value: "999" } });
    expect(screen.queryAllByTestId("rider-lookup-row")).toHaveLength(0);
  });

  it("rows are not actions: no buttons, a tap changes nothing and does not close", () => {
    const onClose = vi.fn();
    render(<RiderLookupModal riders={riders} categories={cats} onClose={onClose} />);
    const row = screen.getAllByTestId("rider-lookup-row")[0];
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
    fireEvent.click(row);
    fireEvent.doubleClick(row);
    expect(onClose).not.toHaveBeenCalled();
    expect(riders[0].lapsCounter).toBe(2); // the rider object is never touched
  });

  it("closes with ✕, Escape and a tap outside", () => {
    const onClose = vi.fn();
    render(<RiderLookupModal riders={riders} categories={cats} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("rider-lookup-close"));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByTestId("rider-lookup"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("status wording", () => {
    expect(lookupStatus({ status: "standing", raceStatus: "finished", lapsCounter: 4, totalLaps: 4 })).toBe("FINISHED");
    expect(lookupStatus({ status: "DSQ", raceStatus: "running", lapsCounter: 1, totalLaps: 4 })).toBe("DSQ");
    expect(lookupStatus({ status: "standing", raceStatus: "running", lapsCounter: 1, totalLaps: 0 })).toBe("RUNNING · lap 1");
  });
});

describe("double-tap status menu order", () => {
  it("is DSQ · DNS · DNF, DNF rightmost", () => {
    const rider = makeRider({ bibNumber: 150, raceStatus: "running", lapsCounter: 0 });
    render(
      <RiderLiveModal
        rider={rider}
        catColor="#f00"
        onClose={() => {}}
        onRevertLap={() => {}}
        onStatusChange={() => {}}
        onSaveComment={() => {}}
      />,
    );
    const order = screen
      .getAllByRole("button")
      .map((b) => b.textContent?.trim())
      .filter((t) => t === "DSQ" || t === "DNS" || t === "DNF");
    expect(order).toEqual(["DSQ", "DNS", "DNF"]);
  });
});
