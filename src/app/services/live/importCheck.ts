import type { RiderProps } from "@/types/types";

/**
 * Checks a start-list import into a SHARED race before anything is written or
 * sent. The server refuses a whole `RidersImported` Action ("invalid") when one
 * rider breaks its rules, and only says "invalid" — so the same rules run here
 * first and name the rows:
 *   - server/src/races/schemas.ts `newRider` (strict field limits),
 *   - src/shared/race/engine.ts `RidersImported` (no duplicate bibs in the
 *     file, no bib already in the race).
 * Keep the limits in step with `newRider` (importCheck.test.ts checks that).
 */

export interface ImportProblem {
  /** Row numbers as the import shows them; empty for a file-wide problem. */
  rows: number[];
  message: string;
}

export const MAX_IMPORT_RIDERS = 5000;
const LIMITS = { firstName: 100, middleName: 100, lastName: 100, category: 120, team: 150, federation: 100, uciNumber: 30 } as const;
const HEX = /^#[0-9A-Fa-f]{6}$/;

const label = (r: RiderProps) => [r.firstName, r.lastName].filter(Boolean).join(" ") || "no name";

export function importProblems(riders: RiderProps[], rowNumbers: number[], existing: RiderProps[]): ImportProblem[] {
  const problems: ImportProblem[] = [];
  const rowOf = (i: number) => rowNumbers[i] ?? i + 1;
  if (riders.length > MAX_IMPORT_RIDERS) problems.push({ rows: [], message: `At most ${MAX_IMPORT_RIDERS} riders per import (this file has ${riders.length})` });

  const bibRows = new Map<number, number[]>();
  const taken = new Map(existing.filter((r) => r.bibNumber > 0).map((r) => [r.bibNumber, r]));

  riders.forEach((r, i) => {
    const row = rowOf(i);
    if (!r.category?.trim()) problems.push({ rows: [row], message: `Row ${row} (${label(r)}): no category` });
    for (const [field, max] of Object.entries(LIMITS)) {
      const v = r[field as keyof RiderProps];
      if (typeof v === "string" && v.length > max) problems.push({ rows: [row], message: `Row ${row}: ${field} is longer than ${max} characters` });
    }
    if (r.bibNumber > 999999) problems.push({ rows: [row], message: `Row ${row}: bib ${r.bibNumber} is too large` });
    if (r.heat != null && (!Number.isInteger(r.heat) || r.heat < 0 || r.heat > 999)) problems.push({ rows: [row], message: `Row ${row}: wave "${r.heat}" is not a number from 0 to 999` });
    for (const f of ["bibColor", "bibTextColor"] as const) {
      if (r[f] && !HEX.test(r[f]!)) problems.push({ rows: [row], message: `Row ${row}: ${f === "bibColor" ? "bib colour" : "bib text colour"} "${r[f]}" is not a colour` });
    }
    if (r.bibNumber > 0) {
      bibRows.set(r.bibNumber, [...(bibRows.get(r.bibNumber) ?? []), row]);
      const already = taken.get(r.bibNumber);
      if (already) problems.push({ rows: [row], message: `Row ${row}: bib ${r.bibNumber} is already in this race (${label(already)})` });
    }
  });
  for (const [bib, rows] of bibRows) {
    if (rows.length > 1) problems.push({ rows, message: `Bib ${bib} appears on rows ${rows.join(", ")}` });
  }
  return problems;
}

/** One readable message for a toast or the import screen (first few problems). */
export function describeProblems(problems: ImportProblem[], max = 5): string {
  const shown = problems.slice(0, max).map((p) => p.message);
  const more = problems.length > max ? ` …and ${problems.length - max} more` : "";
  return `Nothing was imported. ${shown.join("; ")}${more}.`;
}
