import React from "react";
import { formatTimeWithLeadingZeroes } from "@/utils/timeUtils";
import { useTick } from "@/utils/liveTicker";

/**
 * The Live wave clock (Task 5, 2026-11-15). It used to be page state ticking every second,
 * which re-rendered the whole Live screen (cards, keypad, lists) once a second for the
 * entire race. Only this text ticks now.
 *
 * - `startMs` null → "00:00:00" (no started rider, or the board was cleared).
 * - `stopEnds` set → the wave is stopped: frozen at the latest category `finishedAt`; a
 *   category without one counts as "now" (keeps ticking), exactly as before.
 */
export default function WaveClock({ startMs, stopEnds }: { startMs: number | null; stopEnds: (number | null)[] | null }) {
  const frozen = startMs == null || (stopEnds != null && stopEnds.every((e) => e != null));
  const tick = useTick(1000, !frozen);
  if (startMs == null) return <>00:00:00</>;
  const now = frozen ? Date.now() : tick;
  const endMs = stopEnds ? Math.max(...stopEnds.map((e) => e ?? now)) : now;
  return <>{formatTimeWithLeadingZeroes(Math.max(0, endMs - startMs) / 1000)}</>;
}
