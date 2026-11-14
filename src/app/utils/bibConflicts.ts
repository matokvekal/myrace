/**
 * Duplicate bib resolution for start-list imports (Phase 2, Smart Rider Import).
 *
 * A bib is an integer and unique within the WHOLE race (every wave): the engine
 * (`RidersImported` / `RiderAdded` / `RiderEdited`) refuses a taken bib, and Start
 * is blocked on duplicates (`bibIssues.ts`). This module finds the clashes of an
 * import batch BEFORE anything is saved, proposes free numbers, and validates the
 * organizer's final choices. Pure: no store, no network.
 *
 * Proposal rule: 21 → 1021 → 2021 → 3021 …; 189 → 1189 → 2189 …; a bib of 4+
 * digits steps by the next power of ten (1021 → 11021 → 21021). A candidate is
 * free only if no existing rider, no bib of the batch (kept or not) and no earlier
 * proposal uses it.
 *
 * Who keeps the original number: an existing rider of the race always keeps it
 * (every imported row with that bib gets a proposal); inside the file the FIRST
 * row keeps it and the later rows get proposals. The organizer can change any of it.
 */

export const MAX_BIB = 999999;

export interface ImportBibRow {
  /** Index of the rider in the import batch. */
  index: number;
  /** Row number as the import shows it (file line). */
  row: number;
  bib: number;
  name: string;
  category?: string | null;
  heat?: number | null;
}

export interface ExistingBibRider {
  bib: number;
  name: string;
  category?: string | null;
  heat?: number | null;
}

export interface BibProposal extends ImportBibRow {
  /** Number proposed (== bib when this row keeps its original). */
  proposed: number;
  keepsOriginal: boolean;
  reason: string;
}

export interface BibConflictGroup {
  bib: number;
  /** "existing": the bib already belongs to a rider of the race. "file": repeated in the file only. */
  kind: "existing" | "file";
  existing?: ExistingBibRider;
  rows: BibProposal[];
}

export interface BibCorrection {
  index: number;
  originalBib: number;
  correctedBib: number;
  reason: string;
}

const isBib = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

/** Next free number for `bib`: 1000+bib, 2000+bib, … (see module doc). Marks it used. */
export function proposeFreeBib(bib: number, used: Set<number>): number {
  const base = 10 ** Math.max(3, String(bib).length);
  for (let k = 1; k * base + bib <= MAX_BIB; k++) {
    const c = k * base + bib;
    if (!used.has(c)) {
      used.add(c);
      return c;
    }
  }
  // Pattern exhausted (very large bib): the smallest free number above everything used.
  let c = Math.max(bib, ...used) + 1;
  while (c <= MAX_BIB && used.has(c)) c++;
  if (c > MAX_BIB) {
    c = 1;
    while (used.has(c)) c++;
  }
  used.add(c);
  return c;
}

/** The duplicate bibs of an import batch (within the file and against the race), with proposals. */
export function findBibConflicts(rows: ImportBibRow[], existing: ExistingBibRider[]): BibConflictGroup[] {
  const existingByBib = new Map<number, ExistingBibRider>();
  for (const e of existing) if (isBib(e.bib) && !existingByBib.has(e.bib)) existingByBib.set(e.bib, e);

  const byBib = new Map<number, ImportBibRow[]>();
  for (const r of rows) {
    if (!isBib(r.bib)) continue;
    byBib.set(r.bib, [...(byBib.get(r.bib) ?? []), r]);
  }

  // Every number in play: proposals must avoid all of them.
  const used = new Set<number>([...existingByBib.keys(), ...byBib.keys()]);
  const groups: BibConflictGroup[] = [];

  for (const [bib, list] of [...byBib.entries()].sort((a, b) => a[0] - b[0])) {
    const owner = existingByBib.get(bib);
    if (!owner && list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.row - b.row);
    const keeper = owner ? null : sorted[0];
    groups.push({
      bib,
      kind: owner ? "existing" : "file",
      existing: owner,
      rows: sorted.map((r) => {
        if (r === keeper) {
          return { ...r, proposed: bib, keepsOriginal: true, reason: `Keeps bib ${bib} (first row with it)` };
        }
        const reason = owner
          ? `Bib ${bib} already belongs to ${owner.name || "a rider"} in this race`
          : `Bib ${bib} is also on row ${keeper!.row}`;
        return { ...r, proposed: proposeFreeBib(bib, used), keepsOriginal: false, reason };
      }),
    });
  }
  return groups;
}

/**
 * Checks the organizer's final numbers (by batch index) for the conflict rows.
 * Rows of the batch that were not in conflict keep their bib. Returns an error per
 * batch index; empty map = every bib is unique in the race.
 */
export function validateBibChoices(
  rows: ImportBibRow[],
  existing: ExistingBibRider[],
  choices: Map<number, number | null>
): Map<number, string> {
  const errors = new Map<number, string>();
  const taken = new Map<number, ExistingBibRider>();
  for (const e of existing) if (isBib(e.bib)) taken.set(e.bib, e);

  const finalOf = (r: ImportBibRow) => (choices.has(r.index) ? choices.get(r.index) : r.bib);
  const holders = new Map<number, ImportBibRow[]>();
  for (const r of rows) {
    const b = finalOf(r);
    if (choices.has(r.index) && !isBib(b)) {
      errors.set(r.index, `Enter a whole number from 1 to ${MAX_BIB}`);
      continue;
    }
    if (!isBib(b)) continue;
    if (b > MAX_BIB) {
      errors.set(r.index, `Bib must be at most ${MAX_BIB}`);
      continue;
    }
    holders.set(b, [...(holders.get(b) ?? []), r]);
  }
  for (const [b, list] of holders) {
    const owner = taken.get(b);
    for (const r of list) {
      if (errors.has(r.index)) continue;
      if (owner) errors.set(r.index, `Bib ${b} already belongs to ${owner.name || "a rider"}`);
      else if (list.length > 1) {
        const others = list.filter((o) => o !== r).map((o) => o.row);
        errors.set(r.index, `Bib ${b} is also used on row ${others.join(", ")}`);
      }
    }
  }
  return errors;
}

/** The changes to apply (only rows whose number actually changes), with their reasons. */
export function bibCorrectionsFrom(groups: BibConflictGroup[], choices: Map<number, number | null>): BibCorrection[] {
  const out: BibCorrection[] = [];
  for (const g of groups) {
    for (const r of g.rows) {
      const final = choices.has(r.index) ? choices.get(r.index) : r.proposed;
      if (!isBib(final) || final === r.bib) continue;
      const why = g.kind === "existing"
        ? `Duplicate bib at import: ${r.bib} already belonged to ${g.existing?.name || "another rider"}`
        : `Duplicate bib at import: ${r.bib} was also on another row of the file`;
      out.push({ index: r.index, originalBib: r.bib, correctedBib: final, reason: why });
    }
  }
  return out;
}

/** Initial choices = the proposals. */
export function initialBibChoices(groups: BibConflictGroup[]): Map<number, number | null> {
  const m = new Map<number, number | null>();
  for (const g of groups) for (const r of g.rows) m.set(r.index, r.proposed);
  return m;
}
