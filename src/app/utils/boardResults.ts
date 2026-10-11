import type { RiderProps } from "@/types/types";

const OUT = ["DNF", "DSQ", "DNS"];

export interface BoardResultRow {
  rider: RiderProps;
  /** 1-based competition position; null for anyone without one. */
  position: number | null;
  /** Shown instead of a position: "DNF", "DSQ", "DNS" or "Not started". */
  label: string | null;
}

/**
 * Full category result list for the Board's expanded view.
 *
 * `positioned` must already be ranked (calculatePositions). Riders who are on
 * course or finished get consecutive positions in the board's own order: most
 * laps first, then position_category. DNF/DSQ/DNS and riders who have not
 * started are listed AFTER them and never receive a position, so a DNF cannot
 * appear to have placed.
 */
export function buildCategoryResults(positioned: RiderProps[]): BoardResultRow[] {
  const ranked = positioned
    .filter((r) => !OUT.includes(r.status) && (r.raceStatus === "running" || r.raceStatus === "finished"))
    .sort(
      (a, b) =>
        (b.lapsCounter ?? 0) - (a.lapsCounter ?? 0) ||
        (a.position_category ?? 999) - (b.position_category ?? 999)
    )
    .map<BoardResultRow>((rider, i) => ({ rider, position: i + 1, label: null }));

  const rank = (s: string) => OUT.indexOf(s);
  const out = positioned
    .filter((r) => OUT.includes(r.status))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.bibNumber - b.bibNumber)
    .map<BoardResultRow>((rider) => ({ rider, position: null, label: rider.status }));

  const notStarted = positioned
    .filter((r) => !OUT.includes(r.status) && r.raceStatus !== "running" && r.raceStatus !== "finished")
    .sort((a, b) => a.bibNumber - b.bibNumber)
    .map<BoardResultRow>((rider) => ({ rider, position: null, label: "Not started" }));

  return [...ranked, ...out, ...notStarted];
}
