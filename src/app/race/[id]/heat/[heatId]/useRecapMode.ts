import { useCallback, useEffect, useRef, useState } from "react";
import type { RiderProps } from "@/types/types";

/** Inactivity before RECAP MODE ends by itself. */
export const RECAP_IDLE_MS = 30_000;

/**
 * RECAP MODE on the Live screen — a distinct interaction mode, not a panel:
 *  - while active, selecting a rider (tap, voice, or an exact bib) shows their
 *    passages and corrections; it never records a lap;
 *  - Exit RECAP, or 30 s without a meaningful interaction, returns to normal
 *    Live; `touch()` restarts the countdown;
 *  - it never ends by itself while a correction is in progress (`setBusy`).
 */
export function useRecapMode(idleMs: number = RECAP_IDLE_MS) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<RiderProps | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const exit = useCallback(() => {
    setActive(false);
    setSelected(null);
    setBusy(false);
  }, []);
  const enter = useCallback(() => {
    setActive(true);
    setSelected(null);
    setActivity((n) => n + 1);
  }, []);
  const touch = useCallback(() => setActivity((n) => n + 1), []);
  const select = useCallback((rider: RiderProps | null) => {
    setSelected(rider);
    setActivity((n) => n + 1);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!active || busy) return; // never while a correction is in progress
    timer.current = setTimeout(exit, idleMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, busy, activity, idleMs, exit]);

  return { active, selected, busy, enter, exit, touch, select, setBusy };
}
