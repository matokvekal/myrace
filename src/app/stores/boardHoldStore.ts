import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * "Board hold" — how long the live wave board stays frozen after a tap.
 *
 * The problem it solves: at the end of a lap a bunch of 20 riders can cross
 * together. The head commissaire shouts bibs ("1, 55, 44, 666, 234...") and a
 * second commissaire types them as fast as they can. Every recorded lap used to
 * drop that rider's card to the end of the queue 1s later, so during a burst the
 * whole board reshuffled roughly once a second and the typist lost track of
 * where the next card was.
 *
 * Note this is a TRAILING debounce over the whole board, not a per-card delay.
 * A per-card delay does nothing here: with taps arriving once a second, cards
 * still move once a second, just later. Instead the timer restarts on every tap,
 * so nothing moves at all while the burst is running, and every tapped card
 * drops to the bottom together once the arrivals stop.
 */
export const BOARD_HOLD_OPTIONS = [1000, 2000, 3000, 5000, 10000] as const;

export const DEFAULT_BOARD_HOLD_MS = 2000;

/**
 * Safety valve. A steady trickle (a rider every 1.5s against a 2s hold) would
 * restart the debounce forever and freeze the board for the entire race. Once
 * the OLDEST pending card has waited this long the board flushes anyway, even
 * if taps are still coming.
 */
export function maxBoardHoldMs(holdMs: number): number {
  return Math.max(holdMs * 3, 10000);
}

/** Guard against a corrupted/stale persisted value — 0 would defeat the hold. */
export function normalizeBoardHoldMs(ms: unknown): number {
  return typeof ms === 'number' && (BOARD_HOLD_OPTIONS as readonly number[]).includes(ms)
    ? ms
    : DEFAULT_BOARD_HOLD_MS;
}

export function formatBoardHold(ms: number): string {
  return `${ms / 1000} seconds`;
}

interface BoardHoldStore {
  holdMs: number;
  setHoldMs: (ms: number) => void;
}

/**
 * A store rather than a `useState` hook (unlike `useJokerMode`) because the
 * setting is edited from two places that can be open over the live screen —
 * the main side menu and the live screen's settings gear — and the heat page
 * has to pick the new value up immediately, without a remount.
 */
export const useBoardHold = create<BoardHoldStore>()(
  persist(
    (set) => ({
      holdMs: DEFAULT_BOARD_HOLD_MS,
      setHoldMs: (ms) => set({ holdMs: normalizeBoardHoldMs(ms) }),
    }),
    {
      name: 'commissaire.boardHold',
      merge: (persisted, current) => ({
        ...current,
        holdMs: normalizeBoardHoldMs((persisted as Partial<BoardHoldStore> | null)?.holdMs),
      }),
    }
  )
);
