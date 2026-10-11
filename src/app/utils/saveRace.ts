import useRaceStore from "@/stores/racesStore";
import { RaceProps } from "@/types/types";
import { FormEvent } from "react";
import { saveRidersFromCsv, saveRidersFromRows } from "./insertRidersCsv";
import { clearRaceState } from "@/utils/clearRaceState";
import Images from "@/constants/Images";
import { generateRaceId } from "@/services/RaceSync";
import useRiderStore from "@/stores/ridersStore";
import { logAnalyticsEvent } from "@/services/analytics/analyticsClient";
import { AuditLogService } from "@/services/auditLog/auditLogService";

const DEFAULT_IMAGES = [
  Images.bikeMountainSplash,
  Images.bikeSplash,
  Images.peloton1,
  Images.racebefore,
  Images.defaultRaceBike,
];
// const validateText = (text: string): string | null => {
//   const trimmedText = text.trim();
//   if (trimmedText.length < 3 || trimmedText.length > 100) {
//     return "Race name must be between 3 and 100 characters.";
//   }
//   if (/[^a-zA-Z0-9 \-]/.test(trimmedText)) {
//     return "Race name contains invalid characters.";
//   }
//   return null;
// };

const validateDate = (date: string): boolean => {
  return !isNaN(Date.parse(date));
};

export const saveRace = async (
  event: FormEvent<HTMLFormElement>,
  raceName: string,
  startDate: string,
  location: string,
  status: string,
  imageUrl: string | null,
  file: File | null,
  setAddNewwRace: (value: boolean) => void,
  autoColor: boolean = true,
  raceType: "MTB" | "Gravel" = "MTB"
) => {
  event.preventDefault();

  try {
    clearRaceState();

    const resolvedName = raceName.trim() || `Race ${Date.now()}`;
    const resolvedDate = startDate || new Date().toISOString().split("T")[0];
    const resolvedLocation = location.trim() || "TBD";
    const resolvedImage = imageUrl || DEFAULT_IMAGES[Math.floor(Math.random() * DEFAULT_IMAGES.length)];

    // Generate formatted race ID
    const raceId = generateRaceId(resolvedDate, resolvedName);

    const newRace: RaceProps = {
      id: Date.now(),
      uuid: (crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      })),
      raceId,
      owner: "1",
      name: resolvedName,
      location: resolvedLocation,
      time: "08:00",
      date: resolvedDate,
      image: resolvedImage,
      heat: "1",
      status: "upcoming",
      type: "Competition",
      raceType,
      level: "1",
      orgenizer: "Race Org",
      manager: "John Doe",
      phone: "000-000-0000",
      takanon: "",
      site: "",
      createdAt: new Date(),
      lastUpdateAt: new Date(),
      isActive: true,
      autoColor,
      map: "",
      distance: 0,
    };
    // Single writer: insertRace owns both the Zustand cache and the IDB row.
    // (Previously this ALSO did db.add("races") here, then insertRace added the
    // same id again → duplicate-key ConstraintError on every save.)
    const { insertRace } = useRaceStore.getState();
    await insertRace(newRace);

    if (file) {
      // Must finish BEFORE the create screen closes (BUGS.md #18). This used to
      // fire a FileReader and return immediately, so opening the new race could
      // race the import: `createCategoriesFromRiders` runs once, on mount, only
      // when there are no categories yet — if it won that race you ended up with
      // a race that had riders but no categories, and therefore no schedule and
      // no way to start.
      try {
        // .xlsx is binary — read it with the real Excel parser, not file.text()
        // (which mangles it). CSV keeps the text path. (BUGS.md — xlsx on Create
        // Race used to silently import garbage.)
        if (/\.xlsx?$/i.test(file.name)) {
          const { parseXLSXFile } = await import("./xlsxParser");
          const { headers, rows } = await parseXLSXFile(file);
          await saveRidersFromRows([headers, ...rows], newRace.uuid);
        } else {
          await saveRidersFromCsv(await file.text(), newRace.uuid);
        }
      } catch (error) {
        console.error("Error saving riders at saveRidersFromCsv", error);
        throw error;
      }
    }
    logAnalyticsEvent("race_created", {
      race_id: newRace.raceId,
      rider_count: useRiderStore.getState().riders.length,
    });
    AuditLogService.log({
      race: newRace,
      action: "CREATE_RACE",
      screen: "AddRace",
      entityType: "race",
      entityId: newRace.uuid,
      details: { name: newRace.name, date: newRace.date, riderCount: useRiderStore.getState().riders.length },
    });

    setAddNewwRace(false);
  } catch (error) {

    if (error instanceof Error) {
      console.error("Error saving riders:", error.message);
    } else {
      console.error("Unknown error saving riders:", error);
    }
    throw error;
  }
};
