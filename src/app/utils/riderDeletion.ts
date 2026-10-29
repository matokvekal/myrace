import type { RiderProps } from "@/types/types";

/**
 * Why a rider cannot be deleted, or null when it is safe. A rider with race
 * activity — laps, an arrival, a DNF/DSQ, or racing/finished — is part of the
 * results and the sync history: give them a status instead. (Shared races: the
 * engine refuses RiderDeleted for a rider with laps for the same reason.)
 */
export function riderDeletionBlock(
  rider: Pick<RiderProps, "lapsCounter" | "lapsDetails" | "timeArrive" | "raceStatus" | "status">
): string | null {
  if ((rider.lapsCounter ?? 0) > 0 || (rider.lapsDetails?.length ?? 0) > 0) return "this rider already has recorded laps";
  if (rider.timeArrive) return "this rider has a recorded passage";
  if (rider.status === "DNF" || rider.status === "DSQ") return `this rider has a ${rider.status} result`;
  if (rider.raceStatus === "running" || rider.raceStatus === "finished") return "this rider is racing or has finished";
  return null;
}

export const riderLabel = (r: Pick<RiderProps, "firstName" | "lastName" | "bibNumber">) =>
  `${`${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "Unnamed rider"} (Bib ${r.bibNumber || "—"})`;
