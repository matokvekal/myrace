import { useCallback, useEffect, useRef, useState } from "react";

/** Inactivity before RECAP ends by itself. */
export const RECAP_IDLE_MS = 30_000;
/** Duplicate protection while RECAP is active (normal Live uses the race's own minimum). */
export const RECAP_MIN_LAP_SECONDS = 360;

/**
 * RECAP — a temporary TIMING mode on the Live screen: taps, bibs and voice
 * record passages through the normal flow, with a longer duplicate check
 * (RECAP_MIN_LAP_SECONDS instead of the race's minimum). Exit RECAP, or 30 s
 * without an operator interaction (`touch()` restarts the countdown), returns to
 * the race's own minimum.
 */
export function useRecapMode(idleMs: number = RECAP_IDLE_MS) {
  const [active, setActive] = useState(false);
  const [activity, setActivity] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const exit = useCallback(() => setActive(false), []);
  const enter = useCallback(() => {
    setActive(true);
    setActivity((n) => n + 1);
  }, []);
  const touch = useCallback(() => setActivity((n) => n + 1), []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!active) return;
    timer.current = setTimeout(exit, idleMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, activity, idleMs, exit]);

  return { active, enter, exit, touch };
}
