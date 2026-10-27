import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRecapMode, RECAP_IDLE_MS } from "../useRecapMode";
import RecapPanel from "../RecapPanel";
import { makeRider } from "@/test/factories";

/** RECAP MODE: activation, selection, 30 s idle exit, no exit during a correction, cancel, safe corrections. */
describe("useRecapMode", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("activates, selects a rider, and exits after 30 s without interaction", () => {
    const { result } = renderHook(() => useRecapMode());
    act(() => result.current.enter());
    expect(result.current.active).toBe(true);
    const rider = makeRider({ id: 7, bibNumber: 42 });
    act(() => result.current.select(rider));
    expect(result.current.selected?.id).toBe(7);
    act(() => vi.advanceTimersByTime(RECAP_IDLE_MS - 1));
    expect(result.current.active).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.active).toBe(false);
    expect(result.current.selected).toBeNull();
  });

  it("meaningful interactions restart the countdown", () => {
    const { result } = renderHook(() => useRecapMode());
    act(() => result.current.enter());
    act(() => vi.advanceTimersByTime(25_000));
    act(() => result.current.touch());
    act(() => vi.advanceTimersByTime(25_000));
    expect(result.current.active).toBe(true);
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.active).toBe(false);
  });

  it("never exits by itself while a correction is in progress; does after it ends; Exit works at once", () => {
    const { result } = renderHook(() => useRecapMode());
    act(() => result.current.enter());
    act(() => result.current.setBusy(true));
    act(() => vi.advanceTimersByTime(5 * RECAP_IDLE_MS));
    expect(result.current.active).toBe(true);
    act(() => result.current.setBusy(false));
    act(() => vi.advanceTimersByTime(RECAP_IDLE_MS));
    expect(result.current.active).toBe(false);
    act(() => result.current.enter());
    act(() => result.current.exit());
    expect(result.current.active).toBe(false);
  });
});

describe("RecapPanel in RECAP MODE", () => {
  const at = (hm: string) => { const [h, m] = hm.split(":").map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; };
  const rider = makeRider({
    id: 1, bibNumber: 42, firstName: "Dana", lastName: "Levi", raceStatus: "running", status: "standing", timeStartRace: "00:00:00", totalLaps: 5, lapsCounter: 2,
    lapsDetails: [
      { lap: 1, startTime: at("00:00"), endTime: at("00:10"), lapTime: "10:00" },
      { lap: 2, startTime: at("00:10"), endTime: at("00:30"), lapTime: "20:00" },
    ],
  });

  it("selecting a rider shows their passages; a correction in progress is reported busy; Cancel ends it without adding", async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn();
    const onBusyChange = vi.fn();
    render(<RecapPanel riders={[rider]} jokers={[]} minLapMs={180_000} onRecover={onRecover} selectedRider={rider} onBusyChange={onBusyChange} />);
    expect(screen.getByTestId("recap-rider")).toHaveTextContent("#42 Dana Levi");
    expect(screen.getByTestId("recap-rider-passages").textContent).toMatch(/Lap 1.*Lap 2/);
    expect((screen.getByTestId("recap-bib") as HTMLInputElement).value).toBe("42");

    await user.clear(screen.getByTestId("recap-time"));
    await user.type(screen.getByTestId("recap-time"), "00:20");
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByTestId("recap-check"));
    expect(screen.getByTestId("recap-add")).toHaveTextContent("becomes lap 2");
    await user.click(screen.getByTestId("recap-cancel"));
    expect(onRecover).not.toHaveBeenCalled();
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("a safe correction adds the passage at the estimated time; a near one needs Add anyway", async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn();
    render(<RecapPanel riders={[rider]} jokers={[]} minLapMs={180_000} onRecover={onRecover} selectedRider={rider} />);
    await user.clear(screen.getByTestId("recap-time"));
    await user.type(screen.getByTestId("recap-time"), "00:31");
    await user.click(screen.getByTestId("recap-check"));
    expect(screen.queryByTestId("recap-add")).toBeNull();
    expect(screen.getByTestId("recap-add-anyway")).toBeInTheDocument();
    await user.click(screen.getByTestId("recap-cancel"));
    await user.clear(screen.getByTestId("recap-time"));
    await user.type(screen.getByTestId("recap-time"), "00:20");
    await user.click(screen.getByTestId("recap-check"));
    await user.click(screen.getByTestId("recap-add"));
    expect(onRecover).toHaveBeenCalledTimes(1);
    expect(onRecover.mock.calls[0][1].getTime()).toBe(at("00:20").getTime());
  });
});
