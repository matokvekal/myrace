import Papa from "papaparse";
import type { RiderFieldKey } from "@/types/csv.types";
import { autoMapColumns } from "@/services/csvMapper";
import { buildHeatNameMap, filterImportRows, importSkipReason, rowToRider, type ImportSkipReason } from "@/services/riderRowMapper";
import { findBibConflicts, type BibConflictGroup, type ImportBibRow } from "./bibConflicts";

export interface StartListPreview {
  /** How each column was read (header → field, or "—" when not used). */
  mapping: { header: string; field: string | null }[];
  /** "column": waves from an explicit wave column; "start times": no wave column — waves follow start times. */
  waveSource: "column" | "start times";
  riders: number;
  waves: { wave: number; riders: number }[];
  categories: { name: string; wave: number; riders: number }[];
  skipped: { row: number; reason: ImportSkipReason }[];
  warnings: string[];
  /** Phase 2: every rider's bib (index = rider order of the import) and the duplicates among them. */
  bibRows: ImportBibRow[];
  bibConflicts: BibConflictGroup[];
}

const REQUIRED_ANY: RiderFieldKey[][] = [["bibNumber"], ["firstName", "lastName", "fullName"]];

/** Rows (header first) → what the Create Race import would create, without saving anything. */
export async function previewStartListRows(rows: string[][]): Promise<StartListPreview> {
  if (!rows || rows.length < 2) throw new Error("The file is empty.");
  const headers = (rows[0] ?? []).map((h) => String(h ?? "").trim());
  const mappings = await autoMapColumns(headers, rows.slice(1));
  const mapped = new Set(mappings.map((m) => m.targetField).filter(Boolean));
  const missing = REQUIRED_ANY.filter((g) => !g.some((f) => mapped.has(f)));
  if (missing.length) {
    throw new Error(
      `Required column(s) not found: ${missing.map((g) => g.join(" or ")).join("; ")}. Detected headers: ${headers.join(", ") || "(none)"}`
    );
  }
  const { rows: dataRows, skipped } = filterImportRows(rows.slice(1), headers, mappings);
  // File line of each kept row (header = line 1), for the duplicate-bib list.
  const lineOf = rows.slice(1).map((r, i) => ({ r, line: i + 2 })).filter(({ r }) => !importSkipReason(r, headers, mappings)).map(({ line }) => line);
  const heatMap = buildHeatNameMap(dataRows, mappings);
  const riders = dataRows.map((r, i) => rowToRider(r, mappings, "preview", i, heatMap));
  if (!mapped.has("category")) {
    throw new Error(`No column was recognised as Category, so no categories can be created. Detected headers: ${headers.join(", ") || "(none)"}`);
  }
  if (riders.length > 0 && riders.every((r) => !r.category)) {
    throw new Error("The Category column is empty for every rider, so no categories can be created.");
  }

  const waveCount = new Map<number, number>();
  const catCount = new Map<string, { name: string; wave: number; riders: number }>();
  const wavesOfCat = new Map<string, Set<number>>();
  for (const r of riders) {
    const w = r.heat || 0;
    waveCount.set(w, (waveCount.get(w) ?? 0) + 1);
    const key = `${r.category}::${w}`;
    const c = catCount.get(key) ?? { name: r.category || "(no category)", wave: w, riders: 0 };
    c.riders += 1;
    catCount.set(key, c);
    if (!wavesOfCat.has(r.category)) wavesOfCat.set(r.category, new Set());
    wavesOfCat.get(r.category)!.add(w);
  }

  const warnings: string[] = [];
  const bibRows: ImportBibRow[] = riders.map((r, index) => ({
    index, row: lineOf[index] ?? index + 2, bib: r.bibNumber,
    name: [r.firstName, r.lastName].filter(Boolean).join(" "), category: r.category, heat: r.heat ?? null,
  }));
  const bibConflicts = findBibConflicts(bibRows, []); // a new race: no riders yet
  const dupBibs = bibConflicts.map((g) => g.bib);
  if (dupBibs.length) warnings.push(`Duplicate bib numbers: ${dupBibs.slice(0, 10).join(", ")}${dupBibs.length > 10 ? "…" : ""}`);
  const noBib = riders.filter((r) => !(r.bibNumber > 0)).length;
  if (noBib) warnings.push(`${noBib} rider(s) without a bib number`);
  const noCat = riders.filter((r) => !r.category).length;
  if (noCat) warnings.push(`${noCat} rider(s) without a category`);
  for (const [cat, ws] of wavesOfCat) {
    if (ws.size > 1) warnings.push(`Category "${cat}" appears in waves ${[...ws].sort((a, b) => a - b).join(", ")}`);
  }
  const headerRows = skipped.filter((s) => s.reason === "header").length;
  if (headerRows) warnings.push(`${headerRows} repeated header row(s) skipped — they will not become riders or waves`);

  return {
    mapping: headers.map((h, i) => ({ header: h, field: mappings[i]?.targetField ?? null })),
    waveSource: mapped.has("heat") ? "column" : "start times",
    riders: riders.length,
    waves: [...waveCount.entries()].sort((a, b) => a[0] - b[0]).map(([wave, n]) => ({ wave, riders: n })),
    categories: [...catCount.values()].sort((a, b) => a.wave - b.wave || a.name.localeCompare(b.name)),
    skipped,
    warnings,
    bibRows,
    bibConflicts,
  };
}

/** A start-list file (.csv / .xlsx) → preview (same parsing as the Create Race import). */
export async function previewStartListFile(file: File): Promise<StartListPreview> {
  if (/\.xlsx?$/i.test(file.name)) {
    const { parseXLSXFile } = await import("./xlsxParser");
    const { headers, rows } = await parseXLSXFile(file);
    return previewStartListRows([headers, ...rows]);
  }
  const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: true });
  return previewStartListRows(parsed.data as string[][]);
}
