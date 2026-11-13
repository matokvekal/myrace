/**
 * P1: rider cards in a different order on phone and PC. The board order is derived
 * from synced data (last crossing), so a REMOTE lap moves the card too — under the
 * same board hold as a local tap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { sharedQueueOrder, useQueueReconcile } from "../liveQueue";

const T = Date.parse("2026-11-15T08:00:00.000Z");
const r = (id: number, bib: number, arriveMin: number | null, cat = 0) => ({
  id, bibNumber: bib, cat, timeArrive: arriveMin === null ? null : new Date(T + arriveMin * 60000).toISOString(),
});

describe("sharedQueueOrder", () => {
  it("not crossed yet first (category, bib), then last crossing oldest first", () => {
    const riders = [r(1, 10, 12), r(2, 5, null, 1), r(3, 7, 9), r(4, 3, null, 1), r(5, 99, null, 0)];
    expect(sharedQueueOrder(riders, (x) => x.cat)).toEqual([5, 4, 2, 3, 1]);
  });
  it("is independent of the input order (same result on every device)", () => {
    const riders = [r(1, 1, 3), r(2, 2, 3), r(3, 3, null), r(4, 4, 1)];
    const a = sharedQueueOrder(riders, () => 0);
    const b = sharedQueueOrder([...riders].reverse(), () => 0);
    expect(a).toEqual(b);
    expect(a).toEqual([3, 4, 1, 2]);
  });
});

describe("useQueueReconcile", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const mount = (initialQueue: number[], initialDisplay: number[], holdMs = 2000) =>
    renderHook(
      ({ queue, holding }: { queue: number[]; holding: boolean }) => {
        const [displayOrder, setDisplayOrder] = useState(initialDisplay);
        useQueueReconcile({ queueOrder: queue, displayOrder, setDisplayOrder, holding, holdMs });
        return displayOrder;
      },
      { initialProps: { queue: initialQueue, holding: false } },
    );

  it("a remote lap moves the card after the hold, as one move", () => {
    const h = mount([1, 2, 3], [1, 2, 3]);
    h.rerender({ queue: [2, 3, 1], holding: false }); // rider 1 crossed on another device
    expect(h.result.current).toEqual([1, 2, 3]); // board frozen during the hold
    act(() => vi.advanceTimersByTime(1999));
    expect(h.result.current).toEqual([1, 2, 3]);
    act(() => vi.advanceTimersByTime(1));
    expect(h.result.current).toEqual([2, 3, 1]);
  });

  it("never moves while this device's own taps are held", () => {
    const h = mount([1, 2, 3], [1, 2, 3]);
    h.rerender({ queue: [2, 3, 1], holding: true });
    act(() => vi.advanceTimersByTime(60000));
    expect(h.result.current).toEqual([1, 2, 3]);
    h.rerender({ queue: [2, 3, 1], holding: false });
    act(() => vi.advanceTimersByTime(2000));
    expect(h.result.current).toEqual([2, 3, 1]);
  });

  it("a steady trickle of remote laps can't freeze the board past the max hold", () => {
    const start = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const h = mount(start, start);
    const rotate = (n: number) => [...start.slice(n), ...start.slice(0, n)];
    // A remote lap every 1.5 s restarts the 2 s debounce each time; the cap (10 s) must
    // still apply the order while the changes keep coming.
    let moved = false;
    for (let i = 1; i <= 9; i++) {
      h.rerender({ queue: rotate(i), holding: false });
      act(() => vi.advanceTimersByTime(1500));
      if (h.result.current.join() !== start.join()) moved = true;
    }
    expect(moved).toBe(true);
  });
});
