import { riderInCategory } from "../race/[id]/schedule/Schedule";
import type { CategoryProps, RiderProps } from "@/types/types";

/**
 * Riders without a bib (bib 0) or sharing a bib can't be told apart in live
 * recording, so their category can't start (StartManager blocks it). The same
 * check drives the early warning on the Race / Live screens, so the organizer
 * sees the problem before reaching Start — both read from here so they never
 * disagree.
 *
 * Duplicates are counted race-wide (two categories can't share a bib either).
 * DNS riders are ignored: they never cross the line.
 */

type BibRider = Pick<RiderProps, "raceUuid" | "bibNumber" | "status" | "category" | "subCategory">;

export interface CategoryBibIssues {
  noBib: number;
  dupBib: number;
  /** The duplicated bib numbers in this category, sorted. */
  dupBibs: number[];
}

function activeRaceRiders<R extends BibRider>(riders: R[], raceUuid: string): R[] {
  return riders.filter((r) => r.raceUuid === raceUuid && r.status !== "DNS");
}

function bibCounts(raceRiders: BibRider[]): Map<number, number> {
  const count = new Map<number, number>();
  for (const r of raceRiders) {
    if (r.bibNumber) count.set(r.bibNumber, (count.get(r.bibNumber) ?? 0) + 1);
  }
  return count;
}

export function getCategoryBibIssues(
  cat: CategoryProps,
  riders: BibRider[],
  raceUuid: string
): CategoryBibIssues {
  const raceRiders = activeRaceRiders(riders, raceUuid);
  const count = bibCounts(raceRiders);
  const catRiders = raceRiders.filter((r) => riderInCategory(r, cat));
  const dups = catRiders.filter((r) => r.bibNumber && (count.get(r.bibNumber) ?? 0) > 1);
  return {
    noBib: catRiders.filter((r) => !r.bibNumber).length,
    dupBib: dups.length,
    dupBibs: [...new Set(dups.map((r) => r.bibNumber))].sort((a, b) => a - b),
  };
}

/** Human-readable lines, as StartManager shows them. */
export function describeBibIssues(issues: CategoryBibIssues): string[] {
  const out: string[] = [];
  if (issues.noBib > 0) out.push(`${issues.noBib} rider${issues.noBib > 1 ? "s" : ""} without a bib number`);
  if (issues.dupBib > 0) out.push(`${issues.dupBib} rider${issues.dupBib > 1 ? "s" : ""} with a duplicate bib number`);
  return out;
}

export interface RaceBibWarning {
  category: CategoryProps;
  issues: CategoryBibIssues;
}

/** Categories that haven't started yet and would be blocked at Start. */
export function getUpcomingBibWarnings(
  categories: CategoryProps[],
  riders: BibRider[],
  raceUuid: string
): RaceBibWarning[] {
  return categories
    .filter((c) => c.raceUuid === raceUuid && (c.status ?? "upcoming") === "upcoming")
    .map((category) => ({ category, issues: getCategoryBibIssues(category, riders, raceUuid) }))
    .filter(({ issues }) => issues.noBib > 0 || issues.dupBib > 0);
}

// ---------------------------------------------------------------------------
// Per rider (Riders tab): what makes a start-list row invalid until it's fixed.

export type RiderIssue = "noName" | "noBib" | "dupBib";

type CheckedRider = Pick<RiderProps, "id" | "raceUuid" | "bibNumber" | "status" | "firstName" | "lastName">;

/**
 * Riders of a race that need fixing: no name, no bib, or a bib another rider of
 * the race also has. DNS riders are left out of the duplicate check (same rule
 * as Start), but still need a name and a bib.
 */
export function riderIssues(riders: CheckedRider[], raceUuid: string): Map<number, RiderIssue[]> {
  const raceRiders = riders.filter((r) => r.raceUuid === raceUuid);
  const count = bibCounts(activeRaceRiders(raceRiders as unknown as BibRider[], raceUuid));
  const out = new Map<number, RiderIssue[]>();
  for (const r of raceRiders) {
    const issues: RiderIssue[] = [];
    if (!(r.firstName ?? "").trim() && !(r.lastName ?? "").trim()) issues.push("noName");
    if (!r.bibNumber) issues.push("noBib");
    else if (r.status !== "DNS" && (count.get(r.bibNumber) ?? 0) > 1) issues.push("dupBib");
    if (issues.length) out.set(r.id, issues);
  }
  return out;
}

export const RIDER_ISSUE_LABEL: Record<RiderIssue, string> = {
  noName: "No name",
  noBib: "No bib",
  dupBib: "Duplicate bib",
};
