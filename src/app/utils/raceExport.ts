import * as XLSX from "xlsx";
import type { RaceProps, CategoryProps, RiderProps } from "@/types/types";

function safeStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function exportRaceToXlsx(
  race: RaceProps,
  categories: CategoryProps[],
  riders: RiderProps[],
  filenameSuffix?: string
): void {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Race metadata ──────────────────────────────────────
  const raceRows = [
    ["Field", "Value"],
    ["uuid", race.uuid],
    ["id", race.id],
    ["name", race.name ?? ""],
    ["date", race.date ?? ""],
    ["time", race.time ?? ""],
    ["location", race.location ?? ""],
    ["distance", race.distance ?? ""],
    ["type", race.type ?? ""],
    ["level", race.level ?? ""],
    ["orgenizer", race.orgenizer ?? ""],
    ["manager", race.manager ?? ""],
    ["phone", race.phone ?? ""],
    ["site", race.site ?? ""],
    ["takanon", race.takanon ?? ""],
    ["status", race.status ?? "upcoming"],
    ["owner", race.owner ?? ""],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(raceRows), "Race");

  // ── Sheet 2: Categories ─────────────────────────────────────────
  const catHeaders = [
    "id", "raceUuid", "name", "subCategory", "color", "laps", "heat",
    "startTime", "status", "linkedFinish", "finishedAt", "lapsCounter", "riders"
  ];
  const catData = [catHeaders, ...categories.map((c) => catHeaders.map((h) => safeStr(c[h as keyof CategoryProps])))];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(catData), "Categories");

  // ── Sheet 3: Riders ─────────────────────────────────────────────
  const riderHeaders = [
    "id", "raceUuid", "bibNumber", "firstName", "middleName", "lastName",
    "category", "subCategory", "team", "heat", "color", "chipNumber",
    "federation", "points", "flag",
    "totalLaps", "lapsCounter", "lapsDetails",
    "status", "raceStatus", "checked",
    "timeStartRace", "timeArrive",
    "elapsedLastLap", "elapsedTimeFromStart",
    "position_start", "position_category", "position_race",
    "distance", "viewOrder", "comment"
  ];
  const riderData = [
    riderHeaders,
    ...riders.map((r) =>
      riderHeaders.map((h) => {
        if (h === "lapsDetails") return JSON.stringify(r.lapsDetails ?? []);
        return safeStr(r[h as keyof RiderProps]);
      })
    )
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(riderData), "Riders");

  // ── Download ────────────────────────────────────────────────────
  const safeName = (race.name ?? "race").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
  const date = race.date ? race.date.replace(/-/g, "") : new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = filenameSuffix ? `_${filenameSuffix}` : "";
  XLSX.writeFile(wb, `${safeName}_${date}${suffix}.xlsx`);
}
