export type CategoryChipStatus = "upcoming" | "running" | "finished" | null | undefined;

export interface StatusChipInfo {
  label: string;
  color: string;
}

/** Wave/category progress chip: not started / running / finished */
export function getCategoryStatusInfo(status: CategoryChipStatus): StatusChipInfo {
  switch (status) {
    case "running":
      return { label: "Running", color: "#3edda4" };
    case "finished":
      return { label: "Finished", color: "#8a8fa3" };
    default:
      return { label: "Not Started", color: "#63a6fc" };
  }
}

/** Aggregate several categories' statuses into one wave-level chip */
export function getWaveStatusInfo(categoryStatuses: CategoryChipStatus[]): StatusChipInfo {
  if (categoryStatuses.length === 0) return getCategoryStatusInfo("upcoming");
  if (categoryStatuses.every((s) => s === "finished")) return getCategoryStatusInfo("finished");
  if (categoryStatuses.some((s) => s === "running")) return getCategoryStatusInfo("running");
  // Some categories finished, none running, rest never started: the wave is
  // partly done — never call it "Not Started" once races have been run.
  if (categoryStatuses.some((s) => s === "finished"))
    return { label: "Partly Finished", color: "#ffc107" };
  return getCategoryStatusInfo("upcoming");
}

/** Rider progress chip: not started / running / finish / DNF / DNS / DSQ */
export function getRiderStatusInfo(rider: { status?: string | null; raceStatus?: string | null }): StatusChipInfo {
  if (rider.status === "DNF") return { label: "DNF", color: "#ff7830" };
  if (rider.status === "DNS") return { label: "DNS", color: "#e05585" };
  if (rider.status === "DSQ") return { label: "DSQ", color: "#8250c8" };
  if (rider.raceStatus === "finished") return { label: "Finish", color: "#3edda4" };
  if (rider.raceStatus === "running") return { label: "Running", color: "#63a6fc" };
  return { label: "Not Started", color: "#9aa5b8" };
}
