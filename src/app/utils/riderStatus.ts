import type { RiderProps } from "@/types/types";

const OUT_STATUSES = new Set<RiderProps["status"]>(["DNF", "DSQ", "DNS"]);

/** True once the rider has been started or has ridden at least one lap. */
function hasStarted(rider: RiderProps): boolean {
  return rider.raceStatus !== "upcoming" || (rider.lapsCounter ?? 0) > 0 || !!rider.timeStartRace;
}

/**
 * A rider with a new classification, with `raceStatus` kept consistent with it
 * (BUG-05). Used by toggles that set or clear DNF / DSQ / DNS:
 *  - out (DNF/DSQ/DNS): a started rider is off the course → "finished"; a rider
 *    who never started stays "upcoming".
 *  - cleared: back to "standing"; a started rider is "finished" if they had
 *    already completed every lap, otherwise "running"; never-started stays
 *    "upcoming".
 * Laps and times are never touched.
 */
export function withStatus(rider: RiderProps, status: RiderProps["status"]): RiderProps {
  const started = hasStarted(rider);
  if (OUT_STATUSES.has(status)) {
    return { ...rider, status, raceStatus: started ? "finished" : "upcoming" };
  }
  if (!started) return { ...rider, status, raceStatus: "upcoming" };
  const total = rider.totalLaps ?? 0;
  const completed = total > 0 && (rider.lapsCounter ?? 0) >= total;
  return { ...rider, status, raceStatus: completed ? "finished" : "running" };
}
