/**
 * Task 4 (2026-11-15): the pace ring moves every 30 s (not 10 s), at once after a lap and
 * when a card comes on screen; the clock ticks every second only while on screen; all
 * cards share one timer per period; cooldown / cover end exactly on time without a
 * per-second re-render.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import RacingRider from "../RacingRider";
import { makeRider } from "@/test/factories";
import { resetTickers } from "@/utils/liveTicker";
import { useBoardHold } from "@/stores/boardHoldStore";
import type { RiderProps } from "@/types/types";

const T0 = new Date("2026-11-15T09:00:00.000Z").getTime();
const noop = () => {};

/** Rider whose last lap took 10 min and who crossed `agoS` seconds ago. */
const midLap = (agoS: number, over: Partial<RiderProps> = {}) => {
  const arrive = Date.now() - agoS * 1000;
  return makeRider({
    bibNumber: 7,
    raceStatus: "running",
    lapsCounter: 1,
    timeArrive: new Date(arrive).toISOString(),
    lapsDetails: [{ lap: 1, startTime: new Date(arrive - 600_000), endTime: new Date(arrive), lapTime: "00:10:00", position: 1 }],
    ...over,
  });
};
const dash = () => document.querySelector("svg path")?.getAttribute("stroke-dasharray") ?? null;
const elapsedLen = () => Number(dash()!.split(" ")[0]);
const clockText = () => [...screen.getByTestId("racing-rider-7").querySelectorAll("span")].at(-1)?.textContent;

// A controllable IntersectionObserver (jsdom has none).
let ioCallback: IntersectionObserverCallback | null = null;
const observed: Element[] = [];
class FakeIO {
  constructor(cb: IntersectionObserverCallback) { ioCallback = cb; }
  observe(el: Element) { observed.push(el); }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
const setOnScreen = (visible: boolean) =>
  act(() => ioCallback?.(observed.map((target) => ({ target, isIntersecting: visible }) as IntersectionObserverEntry), {} as IntersectionObserver));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  resetTickers();
  useBoardHold.getState().setCoverMs(10000);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  observed.length = 0;
  ioCallback = null;
});

describe("pace ring", () => {
  it("moves every 30 s, not every 10 s", () => {
    render(<RacingRider rider={midLap(60)} color="#f00" onClick={noop} onDoubleClick={noop} />);
    const at0 = elapsedLen();
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(elapsedLen()).toBe(at0);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(elapsedLen()).toBeGreaterThan(at0);
  });

  it("resets the moment a lap is recorded", () => {
    const { rerender } = render(<RacingRider rider={midLap(300)} color="#f00" onClick={noop} onDoubleClick={noop} />);
    expect(elapsedLen()).toBeGreaterThan(0);
    act(() => { vi.advanceTimersByTime(5_000); });
    rerender(<RacingRider rider={midLap(0, { lapsCounter: 2 })} color="#f00" onClick={noop} onDoubleClick={noop} />);
    expect(elapsedLen()).toBe(0);
  });

  it("an off-screen card stops ticking and is exact again as soon as it is on screen", () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    render(<RacingRider rider={midLap(60)} color="#f00" onClick={noop} onDoubleClick={noop} />);
    expect(clockText()).toBe("01:00");
    const ringBefore = elapsedLen();
    setOnScreen(false);
    act(() => { vi.advanceTimersByTime(125_000); });
    expect(clockText()).toBe("01:00"); // nothing re-rendered while off screen
    expect(elapsedLen()).toBe(ringBefore);
    setOnScreen(true);
    expect(clockText()).toBe("03:05");
    expect(elapsedLen()).toBeGreaterThan(ringBefore); // recomputed now, not at the next 30 s tick
  });
});

describe("clock and shared timers", () => {
  it("the since-arrive clock ticks every second while on screen", () => {
    render(<RacingRider rider={midLap(60)} color="#f00" onClick={noop} onDoubleClick={noop} />);
    expect(clockText()).toBe("01:00");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(clockText()).toBe("01:01");
  });

  it("100 cards share one interval per period", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    render(
      <>
        {Array.from({ length: 100 }, (_, i) => (
          <RacingRider key={i} rider={midLap(60 + i, { id: 9000 + i, bibNumber: 500 + i })} color="#f00" onClick={noop} onDoubleClick={noop} />
        ))}
      </>,
    );
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2); // 1 s clock + 30 s ring (was 200)
    spy.mockRestore();
  });

  it("cooldown and cover end exactly on time", () => {
    render(<RacingRider rider={midLap(2)} color="#f00" minLapMs={20_000} onClick={noop} onDoubleClick={noop} />);
    const el = screen.getByTestId("racing-rider-7");
    expect(el).toHaveAttribute("data-covered", "true");
    expect(el).toHaveAttribute("data-cooldown", "true");
    act(() => { vi.advanceTimersByTime(8_100); }); // cover (10 s) over
    expect(el).not.toHaveAttribute("data-covered");
    expect(el).toHaveAttribute("data-cooldown", "true");
    act(() => { vi.advanceTimersByTime(10_000); }); // cooldown (20 s) over
    expect(el).not.toHaveAttribute("data-cooldown");
  });
});
