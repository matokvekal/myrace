/**
 * Live board card order that every judge's device agrees on.
 *
 * The board used to be ordered only by a device-local manual queue: a tap on THIS
 * device moved the card to the end, but a lap recorded on another device updated the
 * rider without moving the card, and a reload re-seeded the queue (category, bib).
 * Phone and PC therefore showed different orders.
 *
 * The shared order is derived from synced race data only — the same rule the local
 * tap already followed ("tapped → last"): riders without a crossing yet on top
 * (category, then bib), then by their LAST crossing time, oldest first.
 * `useQueueReconcile` moves the board to it under the same board hold as a tap.
 */
import { useEffect, useRef } from "react";
import type { RiderProps } from "@/types/types";
import { maxBoardHoldMs } from "@/stores/boardHoldStore";

type QueueRider = Pick<RiderProps, "id" | "timeArrive" | "bibNumber">;

export function sharedQueueOrder<R extends QueueRider>(riders: readonly R[], catRank: (r: R) => number): number[] {
  const arrive = (r: R) => (r.timeArrive ? new Date(r.timeArrive).getTime() || 0 : -1);
  return [...riders]
    .sort((a, b) => {
      const ta = arrive(a);
      const tb = arrive(b);
      if (ta !== tb) return ta - tb;
      const ca = catRank(a);
      const cb = catRank(b);
      if (ca !== cb) return ca - cb;
      return (a.bibNumber || 0) - (b.bibNumber || 0) || a.id - b.id;
    })
    .map((r) => r.id);
}

/**
 * Converge `displayOrder` on `queueOrder`: never while this device's own taps are still
 * held (`holding`), and a change from elsewhere lands as ONE move after a quiet
 * `holdMs` (trailing debounce), at the latest `maxBoardHoldMs` after the first change,
 * so a steady trickle of remote laps can't freeze the board.
 */
export function useQueueReconcile(opts: {
  queueOrder: number[];
  displayOrder: number[];
  setDisplayOrder: (order: number[]) => void;
  holding: boolean;
  holdMs: number;
  disabled?: boolean;
}): void {
  const { queueOrder, displayOrder, setDisplayOrder, holding, holdMs, disabled } = opts;
  const latest = useRef(queueOrder);
  latest.current = queueOrder;
  const setRef = useRef(setDisplayOrder);
  setRef.current = setDisplayOrder;
  const firstAt = useRef<number | null>(null);
  const queueKey = queueOrder.join(",");
  const displayKey = displayOrder.join(",");

  useEffect(() => {
    if (disabled || holding || displayKey === queueKey) {
      firstAt.current = null;
      return;
    }
    const now = Date.now();
    firstAt.current ??= now;
    const deadline = firstAt.current + maxBoardHoldMs(holdMs);
    const timer = setTimeout(() => {
      firstAt.current = null;
      setRef.current([...latest.current]);
    }, Math.max(0, Math.min(holdMs, deadline - now)));
    return () => clearTimeout(timer);
  }, [queueKey, displayKey, holding, holdMs, disabled]);
}
