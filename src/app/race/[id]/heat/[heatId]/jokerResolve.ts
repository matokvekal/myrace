import type { RiderProps } from "@/types/types";

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * Why an Unknown Rider passage (Joker) cannot be assigned to this rider, or null.
 * Checked BEFORE recording, so a refused assignment keeps the Joker (its
 * passage is never lost) and never creates a duplicate lap:
 *   - the rider has finished;
 *   - the rider already has a later passage (laps are recorded in time order);
 *   - the rider already has a passage within the minimum lap time of this one
 *     (that is the same crossing, already counted).
 */
export function jokerResolveBlock(
  rider: Pick<RiderProps, "timeArrive" | "raceStatus" | "totalLaps" | "lapsCounter" | "bibNumber">,
  capturedAt: string,
  minLapMs: number
): string | null {
  if (rider.raceStatus === "finished" || (rider.totalLaps > 0 && rider.lapsCounter >= rider.totalLaps)) {
    return `Bib ${rider.bibNumber} has already finished`;
  }
  if (!rider.timeArrive) return null;
  const last = new Date(rider.timeArrive).getTime();
  const at = new Date(capturedAt).getTime();
  if (last > at) return `Bib ${rider.bibNumber} already has a later passage (${hhmm(last)})`;
  if (at - last < minLapMs) return `Bib ${rider.bibNumber} already has this passage (${hhmm(last)})`;
  return null;
}
