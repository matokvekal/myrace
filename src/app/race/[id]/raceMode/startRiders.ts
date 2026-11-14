import type { RiderProps } from "@/types/types";

/**
 * A rider at the GO of their wave: the CURRENT rider (read from the store at write time)
 * with ONLY the start fields changed. Identity fields — wave, bib, names, category — are
 * never touched here: on a shared race any difference in them becomes a `RiderEdited`
 * that the server refuses once the wave has started (the 55 "not applied" of 2026-11-14).
 */
export function startRiderPatch(current: RiderProps, startClock: string, index: number): RiderProps {
  return {
    ...current,
    raceStatus: "running",
    timeStartRace: startClock,
    lapsCounter: 0,
    viewOrder: current.position_start ?? index + 1,
  };
}
