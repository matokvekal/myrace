import type { ColumnMapping } from "@/types/csv.types";
import type { RiderProps } from "@/types/types";
import { splitFullName } from "@/services/csvMapper";
import useClubDictionaryStore from "@/stores/clubDictionaryStore";

/**
 * Build a rider from one parsed CSV/scan row using the resolved column mappings.
 *
 * Single implementation shared by BOTH import paths (BUGS.md #20): the 4-step
 * import wizard and the Create Race screen's start-list upload. They previously
 * had separate builders that disagreed on which fields they understood, so the
 * same file could import differently depending on where you dropped it.
 */
export function rowToRider(
  row: string[],
  mappings: ColumnMapping[],
  raceUuid: string,
  index: number,
  heatNameToNumber: Map<string, number> = new Map(),
  clubDictionary?: typeof useClubDictionaryStore
): RiderProps {
  const data: Record<string, any> = {};
  // Columns the user chose to "Keep as info" (BUGS.md #7): raw value, keyed by
  // the original column header, surfaced on the rider card's "More info".
  const infoFields: Record<string, string> = {};

  mappings.forEach((mapping, colIdx) => {
    if (!mapping.targetField) return;
    const value = row[colIdx]?.trim() || "";

    switch (mapping.targetField) {
      case "infoField":
        if (value) infoFields[mapping.sourceColumn] = value;
        break;
      case "bibNumber":
        data.bibNumber = parseInt(value) || 0;
        break;
      case "firstName":
        data.firstName = value;
        break;
      case "middleName":
        data.middleName = value || null;
        break;
      case "lastName":
        data.lastName = value;
        break;
      case "fullName": {
        const { firstName, lastName } = splitFullName(value);
        data.firstName = firstName;
        data.lastName = lastName;
        break;
      }
      case "category":
        data.category = value;
        break;
      case "subCategory":
        // Recognised so it can't be mistaken for the category column, but never
        // imported — categories are flat, one per age band (BUGS.md #2).
        break;
      case "team": {
        let teamValue = value || null;
        // Apply club dictionary mapping if available
        if (clubDictionary && teamValue) {
          const getStandardName = clubDictionary.getState().getStandardName;
          const standardName = getStandardName(teamValue);
          if (standardName) {
            teamValue = standardName;
            const incrementUsageCount = clubDictionary.getState().incrementUsageCount;
            // Find the matching entry to increment usage
            const entries = clubDictionary.getState().getAllEntries();
            const entry = entries.find(e =>
              e.hebrewName.toLowerCase() === value.toLowerCase() ||
              e.alternateNames.some(alt => alt.toLowerCase() === value.toLowerCase())
            );
            if (entry) incrementUsageCount(entry.id);
          }
        }
        data.team = teamValue;
        break;
      }
      case "heat": {
        const numVal = parseInt(value);
        // Use numeric value if available, otherwise look up from name map
        data.heat = !isNaN(numVal) ? numVal : (heatNameToNumber.get(value) ?? 0);
        break;
      }
      case "startTime":
        data.timeStartRace = value || null;
        break;
      case "totalLaps":
        data.totalLaps = parseInt(value) || 0;
        break;
      case "position":
        data.position_start = parseInt(value) || null;
        break;
      case "standing":
        data.standing = parseInt(value) || null;
        break;
      case "points":
        data.points = parseFloat(value) || null;
        break;
      case "uciPoints":
        data.uciPoints = parseFloat(value) || null;
        break;
      case "federation":
        data.federation = value || null;
        break;
      case "firstNameEnglish":
        data.firstNameEnglish = value || null;
        break;
      case "lastNameEnglish":
        data.lastNameEnglish = value || null;
        break;
      case "uciNumber":
        data.uciNumber = value || null;
        break;
      case "idNumber":
        data.idNumber = value || null;
        break;
      case "birthDate":
        data.birthDate = value || null;
        break;
      case "federationNumber":
        data.federationNumber = value || null;
        break;
      case "federationChip":
        data.federationChip = value || null;
        break;
      case "roadNumber":
        data.roadNumber = value || null;
        break;
      case "chip":
        data.chip = value || null;
        break;
      case "notes":
        data.notes = value || null;
        break;
      case "raceDay":
        // grouping only — not stored on rider
        break;
    }
  });

  // Reference-only columns: kept on the rider and shown on the full card, but not
  // used by the app (BUGS.md #A — e.g. UCI number, ID, road number). Previously
  // these were parsed then dropped.
  const extraFields: Record<string, string> = {};
  const EXTRA_LABELS: Array<[string, string]> = [
    ["uciNumber", "UCI Number"],
    ["uciPoints", "UCI Points"],
    ["idNumber", "ID Number"],
    ["birthDate", "Birth Date"],
    ["federationNumber", "Federation Number"],
    ["federationChip", "Federation Chip"],
    ["roadNumber", "Road Number"],
    ["chip", "Chip"],
    ["notes", "Notes"],
    ["firstNameEnglish", "First Name (EN)"],
    ["lastNameEnglish", "Last Name (EN)"],
  ];
  for (const [key, label] of EXTRA_LABELS) {
    const v = data[key];
    if (v != null && String(v).trim() !== "") extraFields[label] = String(v);
  }
  // User-selected "Keep as info" columns, keyed by their original header. A
  // recognised label already present wins, so these never clobber a known field.
  for (const [header, value] of Object.entries(infoFields)) {
    if (!(header in extraFields)) extraFields[header] = value;
  }

  return {
    id: Date.now() + index,
    raceUuid,
    bibNumber: data.bibNumber ?? 0,
    firstName: data.firstName ?? "",
    middleName: data.middleName ?? null,
    lastName: data.lastName ?? "",
    category: data.category ?? "",
    team: data.team ?? null,
    heat: data.heat ?? 0,
    totalLaps: data.totalLaps ?? 0,
    timeStartRace: data.timeStartRace ?? null,
    position_start: data.position_start ?? null,
    standing: data.standing ?? null,
    lapsCounter: 0,
    lapsDetails: [],
    checked: false,
    distance: 0,
    elapsedTimeFromStart: "0",
    timeArrive: null,
    flag: null,
    position_category: 0,
    position_race: 0,
    raceStatus: "upcoming",
    status: "standing",
    viewOrder: 0,
    color: null,
    elapsedLastLap: null,
    image: null,
    comment: null,
    points: data.points ?? null,
    uciPoints: data.uciPoints ?? null,
    federation: data.federation ?? null,
    uciNumber: data.uciNumber ?? null,
    extraFields: Object.keys(extraFields).length > 0 ? extraFields : undefined
  };
}
