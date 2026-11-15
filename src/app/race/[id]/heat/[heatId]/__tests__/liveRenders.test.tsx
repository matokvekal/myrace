/**
 * Task 5 (2026-11-15): the Live page no longer re-renders every second (the wave clock
 * ticks on its own) and a rider card re-renders only when what it shows changed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

// Counts card renders: the card calls useSkin() once per render.
const { cardRenders } = vi.hoisted(() => ({ cardRenders: { n: 0 } }));
vi.mock("@/hooks/useSkin", () => ({ useSkin: () => { cardRenders.n++; return { skin: "classic" }; } }));
import WaveClock from "../WaveClock";
import RacingRider, { sameCardProps } from "../../../categories/racingRider/RacingRider";
import { resetTickers } from "@/utils/liveTicker";
import { makeRider } from "@/test/factories";

const T0 = new Date("2026-11-15T09:00:00.000Z").getTime();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  resetTickers();
});
afterEach(() => vi.useRealTimers());

describe("WaveClock", () => {
  it("ticks every second by itself, without re-rendering its parent", () => {
    let parentRenders = 0;
    const Parent = () => {
      parentRenders++;
      return <p data-testid="clock"><WaveClock startMs={T0 - 65_000} stopEnds={null} /></p>;
    };
    render(<Parent />);
    expect(screen.getByTestId("clock").textContent).toBe("00:01:05");
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByTestId("clock").textContent).toBe("00:01:08");
    expect(parentRenders).toBe(1);
  });

  it("freezes at the latest finish of a stopped wave; a category without a finish keeps it running; no start → 00:00:00", () => {
    const { rerender } = render(<p data-testid="clock"><WaveClock startMs={T0 - 600_000} stopEnds={[T0 - 300_000, T0 - 120_000]} /></p>);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByTestId("clock").textContent).toBe("00:08:00");
    rerender(<p data-testid="clock"><WaveClock startMs={T0 - 600_000} stopEnds={[T0 - 300_000, null]} /></p>);
    expect(screen.getByTestId("clock").textContent).toBe("00:10:05");
    rerender(<p data-testid="clock"><WaveClock startMs={null} stopEnds={null} /></p>);
    expect(screen.getByTestId("clock").textContent).toBe("00:00:00");
  });
});

describe("rider card memo", () => {
  const onClick = () => {};
  const onOpen = () => {};
  const rider = makeRider({ bibNumber: 7, raceStatus: "running", lapsCounter: 1, timeArrive: new Date(T0 - 60_000).toISOString() });

  it("a fresh copy of an unchanged rider (every re-ranking makes one) does not re-render the card", () => {
    const view = (r: typeof rider, phaseRemaining = 2) => (
      <RacingRider rider={r} color="#f00" phase={{ icon: "none", remaining: phaseRemaining, finishPhase: false, nextCrossingFinishes: false }} onClick={onClick} onDoubleClick={onOpen} />
    );
    const renders = () => cardRenders.n;
    const { rerender } = render(view(rider));
    const after = renders();
    rerender(view({ ...rider })); // same values, new object, new phase object
    expect(renders()).toBe(after);
    rerender(view({ ...rider, lapsCounter: 2 }));
    expect(renders()).toBe(after + 1);
    rerender(view({ ...rider, lapsCounter: 2 }, 1)); // phase changed
    expect(renders()).toBe(after + 2);
  });

  it("compares every prop that is shown", () => {
    const base = { rider, color: "#f00", onClick, onDoubleClick: onOpen };
    expect(sameCardProps(base, { ...base, rider: { ...rider } })).toBe(true);
    expect(sameCardProps(base, { ...base, color: "#0f0" })).toBe(false);
    expect(sameCardProps(base, { ...base, isRecorded: true })).toBe(false);
    expect(sameCardProps(base, { ...base, isFlashing: true })).toBe(false);
    expect(sameCardProps(base, { ...base, raceEnded: true })).toBe(false);
    expect(sameCardProps(base, { ...base, minLapMs: 1 })).toBe(false);
    expect(sameCardProps(base, { ...base, rider: { ...rider, position_category: 9 } })).toBe(false);
    expect(sameCardProps(base, { ...base, onClick: () => {} })).toBe(false);
  });
});
