import Papa from "papaparse";
import type { RiderFieldKey } from "@/types/csv.types";
import { autoMapColumns } from "@/services/csvMapper";
import { buildHeatNameMap, filterImportRows, rowToRider, type ImportSkipReason } from "@/services/riderRowMapper";

export interface StartListPreview {
  riders: number;
  waves: { wave: number; riders: number }[];
  categories: { name: string; wave: number; riders: number }[];
  skipped: { row: number; reason: ImportSkipReason }[];
  warnings: string[];
}

const REQUIRED_ANY: RiderFieldKey[][] = [["bibNumber"], ["firstName", "lastName", "fullName"]];

/** Rows (header first) → what the Create Race import would create, without saving anything. */
export async function previewStartListRows(rows: string[][]): Promise<StartListPreview> {
  if (!rows || rows.length < 2) throw new Error("The file is empty.");
  const headers = (rows[0] ?? []).map((h) => String(h ?? "").trim());
  const mappings = await autoMapColumns(headers);
  const mapped = new Set(mappings.map((m) => m.targetField).filter(Boolean));
  const missing = REQUIRED_ANY.filter((g) => !g.some((f) => mapped.has(f)));
  if (missing.length) {
    throw new Error(
      `Required column(s) not found: ${missing.map((g) => g.join(" or ")).join("; ")}. Detected headers: ${headers.join(", ") || "(none)"}`
    );
  }
  const { rows: dataRows, skipped } = filterImportRows(rows.slice(1), headers, mappings);
  const heatMap = buildHeatNameMap(dataRows, mappings);
  const riders = dataRows.map((r, i) => rowToRider(r, mappings, "preview", i, heatMap));

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
  const bibs = riders.map((r) => r.bibNumber).filter((b) => b > 0);
  const dupBibs = [...new Set(bibs.filter((b, i) => bibs.indexOf(b) !== i))];
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
    riders: riders.length,
    waves: [...waveCount.entries()].sort((a, b) => a[0] - b[0]).map(([wave, n]) => ({ wave, riders: n })),
    categories: [...catCount.values()].sort((a, b) => a.wave - b.wave || a.name.localeCompare(b.name)),
    skipped,
    warnings,
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
