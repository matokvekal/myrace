import * as XLSX from "xlsx";
import type { CategoryProps, RiderProps, RaceFinalization, RaceTrack, TrackMarker } from "@/types/types";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { riderInCategory, catWaveKey } from "../race/[id]/schedule/Schedule";
import { verifyExportToken } from "./raceSignature";

export interface ImportResult {
  raceUuid: string;
  categories: CategoryProps[];
  riders: RiderProps[];
  raceName: string;
  /**
   * Set when the file came from a race that was closed with "Finish Race" AND
   * the record verifies against itself. A full "replace" import adopts it, so a
   * final result handed to another commissaire arrives locked on their device
   * too — they can read and export it, not edit it.
   *
   * Unverifiable records are dropped rather than trusted: a hand-written
   * "finalized" row must not be able to lock someone else's race.
   */
  finalized?: RaceFinalization;
  /** Course maps carried in the file (absent in files exported before multi-map support). */
  tracks?: RaceTrack[];
}

/** Parse + self-verify the finalization record stored on the Race sheet. */
async function parseFinalized(raw: string | undefined): Promise<RaceFinalization | undefined> {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as RaceFinalization;
    if (!parsed?.payload || !parsed?.token) return undefined;
    return (await verifyExportToken(parsed.payload, parsed.token)) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parseNum(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function parseBool(v: unknown): boolean {
  if (v === true || v === "true" || v === "TRUE" || v === 1 || v === "1") return true;
  return false;
}

function parseNullableStr(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" || s === "null" || s === "undefined" ? null : s;
}

function sheetToObjects(sheet: XLSX.WorkSheet): Record<string, string>[] {
  const data: (string | number | boolean | null)[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1, defval: "", raw: false, blankrows: false
  });
  if (data.length < 2) return [];
  const headers = data[0].map((h) => String(h ?? "").trim());
  return data.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = String(row[i] ?? "").trim(); });
    return obj;
  });
}

function parseKeyList(v: string | undefined): string[] {
  try {
    const arr = v ? JSON.parse(v) : [];
    return Array.isArray(arr) ? arr.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

export async function importRaceFromXlsx(file: File): Promise<ImportResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: false });

  // ── Race metadata ───────────────────────────────────────────────
  const raceSheet = wb.Sheets["Race"];
  if (!raceSheet) throw new Error("Invalid file: missing 'Race' sheet");

  const raceRows: Record<string, string> = {};
  const rawRace: string[][] = XLSX.utils.sheet_to_json(raceSheet, { header: 1, defval: "", raw: false });
  rawRace.forEach((row) => { if (row[0]) raceRows[String(row[0])] = String(row[1] ?? ""); });

  const raceUuid = raceRows["uuid"];
  const raceName = raceRows["name"] ?? "Imported Race";
  if (!raceUuid) throw new Error("Invalid file: missing race UUID");

  // ── Categories ──────────────────────────────────────────────────
  const catSheet = wb.Sheets["Categories"];
  if (!catSheet) throw new Error("Invalid file: missing 'Categories' sheet");

  const catRows = sheetToObjects(catSheet);
  const categories: CategoryProps[] = catRows.map((row) => ({
    id: parseNum(row.id),
    raceUuid,
    name: row.name ?? "",
    subCategory: parseNullableStr(row.subCategory),
    color: parseNullableStr(row.color),
    laps: row.laps !== "" ? parseNum(row.laps) : null,
    heat: row.heat !== "" ? parseNum(row.heat) : null,
    startTime: parseNullableStr(row.startTime),
    status: (row.status as CategoryProps["status"]) ?? "upcoming",
    linkedFinish: parseBool(row.linkedFinish),
    finishedAt: row.finishedAt ? parseNum(row.finishedAt) : undefined,
    lapsCounter: parseNum(row.lapsCounter),
    riders: parseNum(row.riders),
    isConnected: false,
    importOrder: row.importOrder ? parseNum(row.importOrder) : undefined,
  }));

  // ── Riders ──────────────────────────────────────────────────────
  const riderSheet = wb.Sheets["Riders"];
  if (!riderSheet) throw new Error("Invalid file: missing 'Riders' sheet");

  const riderRows = sheetToObjects(riderSheet);
  const riders: RiderProps[] = riderRows.map((row) => {
    let lapsDetails: RiderProps["lapsDetails"] = [];
    try {
      if (row.lapsDetails && row.lapsDetails !== "[]" && row.lapsDetails !== "") {
        lapsDetails = JSON.parse(row.lapsDetails);
      }
    } catch { lapsDetails = []; }

    let extraFields: RiderProps["extraFields"];
    try {
      if (row.extraFields) {
        const parsed = JSON.parse(row.extraFields);
        if (parsed && typeof parsed === "object") extraFields = parsed;
      }
    } catch { extraFields = undefined; }

    return {
      id: parseNum(row.id),
      raceUuid,
      standing: row.standing !== "" && row.standing !== undefined ? parseNum(row.standing) : null,
      uciPoints: row.uciPoints ? parseNum(row.uciPoints) : null,
      uciNumber: parseNullableStr(row.uciNumber),
      extraFields,
      bibNumber: parseNum(row.bibNumber),
      firstName: row.firstName ?? "",
      middleName: parseNullableStr(row.middleName),
      lastName: row.lastName ?? "",
      category: row.category ?? "",
      subCategory: parseNullableStr(row.subCategory),
      team: parseNullableStr(row.team),
      heat: parseNum(row.heat),
      color: parseNullableStr(row.color),
      chipNumber: row.chipNumber || undefined,
      federation: parseNullableStr(row.federation),
      points: row.points !== "" ? parseNum(row.points) : null,
      flag: parseNullableStr(row.flag),
      totalLaps: parseNum(row.totalLaps),
      lapsCounter: parseNum(row.lapsCounter),
      lapsDetails,
      status: (row.status as RiderProps["status"]) ?? "standing",
      raceStatus: (row.raceStatus as RiderProps["raceStatus"]) ?? "upcoming",
      checked: parseBool(row.checked),
      timeStartRace: parseNullableStr(row.timeStartRace),
      timeArrive: parseNullableStr(row.timeArrive),
      elapsedLastLap: parseNullableStr(row.elapsedLastLap),
      elapsedTimeFromStart: parseNullableStr(row.elapsedTimeFromStart),
      position_start: row.position_start !== "" ? parseNum(row.position_start) : null,
      position_category: parseNum(row.position_category),
      position_race: parseNum(row.position_race),
      distance: row.distance !== "" ? parseNum(row.distance) : null,
      viewOrder: parseNum(row.viewOrder),
      comment: parseNullableStr(row.comment),
      image: null,
    };
  });

  // ── Course maps (optional sheets) ───────────────────────────────
  let tracks: RaceTrack[] | undefined;
  const trackSheet = wb.Sheets["Tracks"];
  if (trackSheet) {
    const byId = new Map<string, RaceTrack>();
    for (const row of sheetToObjects(trackSheet)) {
      if (!row.id) continue;
      const lat = parseFloat(row.centerLat);
      const lng = parseFloat(row.centerLng);
      byId.set(row.id, {
        id: row.id,
        title: row.title ?? "",
        header: row.header ?? "",
        color: row.color || "#3b82f6",
        points: [],
        markers: [],
        center: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
        zoom: row.zoom !== "" && row.zoom !== undefined ? parseNum(row.zoom) : undefined,
        categoryKeys: parseKeyList(row.categories),
      });
    }
    const pointSheet = wb.Sheets["TrackPoints"];
    if (pointSheet) {
      // seq keeps the original order — point order IS the direction of travel
      const rows = sheetToObjects(pointSheet).sort((a, b) => parseNum(a.seq) - parseNum(b.seq));
      for (const row of rows) {
        const t = byId.get(row.trackId);
        const lat = parseFloat(row.lat);
        const lng = parseFloat(row.lng);
        if (!t || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (row.kind === "route") t.points.push([lat, lng]);
        else if (row.kind === "marker") {
          t.markers.push({ lat, lng, label: row.label, type: (row.type || "point") as TrackMarker["type"] });
        }
      }
    }
    tracks = [...byId.values()];
  }

  return {
    raceUuid,
    categories,
    riders,
    raceName,
    tracks,
    finalized: await parseFinalized(raceRows["finalized"]),
  };
}

export interface MergeResult {
  categories: CategoryProps[];
  riders: RiderProps[];
}

// Replaces ONLY the given categories (matched by name + subCategory) and their
// riders inside one race — everything else in the race is untouched. This is the
// multi-commissaire flow: each device records its own categories, and the main
// device merges the result files one by one at the end of the race.
export async function mergeCategoriesIntoRace(
  raceUuid: string,
  importedCats: CategoryProps[],
  importedRiders: RiderProps[]
): Promise<MergeResult> {
  const db = await initIndexedDB();
  const allCats: CategoryProps[] = await db.getAll("categories");
  const allRiders: RiderProps[] = await db.getAll("riders");

  const selectedKeys = new Set(importedCats.map((c) => catWaveKey(c.name, c.subCategory)));

  const catsToDelete = allCats.filter(
    (c) => c.raceUuid === raceUuid && selectedKeys.has(catWaveKey(c.name, c.subCategory))
  );
  const ridersToDelete = allRiders.filter(
    (r) => r.raceUuid === raceUuid && importedCats.some((c) => riderInCategory(r, c))
  );

  // Only riders that belong to the merged categories may come in
  const incomingRiders = importedRiders.filter((r) =>
    importedCats.some((c) => riderInCategory(r, c))
  );

  // ids are global across the whole store (other races too) — an imported record
  // must never overwrite a record we are not deliberately replacing.
  const deletedCatIds = new Set(catsToDelete.map((c) => c.id));
  const deletedRiderIds = new Set(ridersToDelete.map((r) => r.id));
  const takenCatIds = new Set(allCats.filter((c) => !deletedCatIds.has(c.id)).map((c) => c.id));
  const takenRiderIds = new Set(allRiders.filter((r) => !deletedRiderIds.has(r.id)).map((r) => r.id));

  let nextId = Date.now();
  const freshId = (taken: Set<number>): number => {
    while (taken.has(nextId)) nextId++;
    return nextId++;
  };

  const finalCats = importedCats.map((c) =>
    takenCatIds.has(c.id) ? { ...c, id: freshId(takenCatIds) } : c
  );
  const finalRiders = incomingRiders.map((r) =>
    takenRiderIds.has(r.id) ? { ...r, id: freshId(takenRiderIds) } : r
  );

  const catTx = db.transaction("categories", "readwrite");
  const catStore = catTx.objectStore("categories");
  for (const c of catsToDelete) await catStore.delete(c.id);
  for (const c of finalCats) await catStore.put(c);
  await catTx.done;

  const riderTx = db.transaction("riders", "readwrite");
  const riderStore = riderTx.objectStore("riders");
  for (const r of ridersToDelete) await riderStore.delete(r.id);
  for (const r of finalRiders) await riderStore.put(r);
  await riderTx.done;

  db.close();
  return { categories: finalCats, riders: finalRiders };
}

export async function replaceCategoriesForRace(
  raceUuid: string,
  newCategories: CategoryProps[]
): Promise<void> {
  const db = await initIndexedDB();
  const allCats: CategoryProps[] = await db.getAll("categories");
  const toDelete = allCats.filter((c) => c.raceUuid === raceUuid);

  const tx = db.transaction("categories", "readwrite");
  const store = tx.objectStore("categories");
  for (const c of toDelete) await store.delete(c.id);
  for (const c of newCategories) await store.put(c);
  await tx.done;
  db.close();
}
