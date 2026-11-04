/**
 * Finish Race: what finalizing does to each rider and category — ONE rule for the
 * confirmation modal (shows the exact impact first), the app's local finalize and
 * the server's finalize (persisted in one transaction). Pure.
 *
 *  - FINISHED, DNF, DSQ and DNS results are kept as they are.
 *  - A rider who started and is still on course becomes FINISHED on the laps
 *    actually completed — no laps or finish times are invented. Never DNF: DNF is
 *    a commissaire's decision, not something inferred from the clock (CLAUDE.md).
 *  - A rider who never started (their wave/category never started) becomes DNS.
 *  - Every category is closed; one that never started is "not started"
 *    (closed with no start time). Ignored categories are left alone.
 */
export interface PlanRider {
  uuid?: string | null;
  bibNumber?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  category: string;
  subCategory?: string | null;
  status: string;
  raceStatus?: string | null;
  timeStartRace?: string | null;
}
export interface PlanCategory {
  uuid?: string | null;
  name: string;
  subCategory?: string | null;
  status?: string | null;
  startedAt?: unknown;
  ignored?: boolean | null;
  heat?: number | string | null;
}

export interface FinalPlan<R extends PlanRider, C extends PlanCategory> {
  finished: R[];
  /** Started, still on course: closed as FINISHED on their completed laps. */
  toFinish: R[];
  toDNS: R[];
  kept: { DNF: R[]; DSQ: R[]; DNS: R[] };
  /** Categories that never started: closed as "not started". */
  notStarted: C[];
  /** Categories still open that will be closed (started or not). */
  toClose: C[];
}

const OUT = new Set(["DNF", "DSQ", "DNS"]);
const key = (name: string, sub?: string | null) => `${name}::${sub ?? ""}`;

/** A category started when it is running, or finished after a start (a start time was stamped). */
export const categoryStarted = (c: PlanCategory): boolean => c.status === "running" || (c.status === "finished" && c.startedAt != null);

export function planFinalization<R extends PlanRider, C extends PlanCategory>(riders: R[], categories: C[]): FinalPlan<R, C> {
  const byKey = new Map(categories.map((c) => [key(c.name, c.subCategory), c]));
  const plan: FinalPlan<R, C> = { finished: [], toFinish: [], toDNS: [], kept: { DNF: [], DSQ: [], DNS: [] }, notStarted: [], toClose: [] };
  for (const c of categories) {
    if (c.ignored) continue;
    if (c.status !== "finished") plan.toClose.push(c);
    if (!categoryStarted(c)) plan.notStarted.push(c);
  }
  for (const r of riders) {
    const cat = byKey.get(key(r.category, r.subCategory));
    if (cat?.ignored) continue; // ignored waves take no part (data kept as is)
    if (OUT.has(r.status)) {
      plan.kept[r.status as "DNF" | "DSQ" | "DNS"].push(r);
      continue;
    }
    const riderStarted = r.raceStatus === "running" || r.raceStatus === "finished" || !!r.timeStartRace;
    if (!riderStarted) plan.toDNS.push(r);
    else if (r.status === "finished" || r.raceStatus === "finished") plan.finished.push(r);
    else plan.toFinish.push(r); // started, still on course: finishes on the laps completed
  }
  return plan;
}
