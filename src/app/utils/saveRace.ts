import useRaceStore from "@/stores/racesStore";
import useCategoryStore from "@/stores/categoryStore";
import { DEFAULT_MIN_LAP_SECONDS } from "./minLap";
import { RaceProps } from "@/types/types";
import { FormEvent } from "react";
import { saveRidersFromCsv, saveRidersFromRows } from "./insertRidersCsv";
import { clearRaceState } from "@/utils/clearRaceState";
import Images from "@/constants/Images";
import { generateRaceId } from "@/services/RaceSync";
import useRiderStore from "@/stores/ridersStore";
import { logAnalyticsEvent } from "@/services/analytics/analyticsClient";
import { AuditLogService } from "@/services/auditLog/auditLogService";
import type { NewRaceStorage } from "@/services/live/liveClient";
import { newLocalId } from "@/utils/localId";

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
): Promise<NewRaceStorage | null> => {
  event.preventDefault();

  // Creating a race needs an account when this build has a server (races live in the cloud).
  if (import.meta.env.VITE_SERVER_URL && !(await import("@/services/live/liveClient")).isSignedIn()) {
    throw new Error("Sign in to create a race — races are saved to your account in the cloud.");
  }

  try {
    clearRaceState();

    const resolvedName = raceName.trim() || `Race ${Date.now()}`;
    const resolvedDate = startDate || new Date().toISOString().split("T")[0];
    const resolvedLocation = location.trim() || "TBD";
    const resolvedImage = imageUrl || DEFAULT_IMAGES[Math.floor(Math.random() * DEFAULT_IMAGES.length)];

    // Generate formatted race ID
    const raceId = generateRaceId(resolvedDate, resolvedName);

    const newRace: RaceProps = {
      id: newLocalId(),
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
      // New races: 3 minutes minimum between two counted passages (configurable in Race Settings).
      minLapSeconds: DEFAULT_MIN_LAP_SECONDS,
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
        // Categories first, independent of waves: every imported rider must
        // belong to a created category. Zero categories = a failed import.
        await useCategoryStore.getState().createCategoriesFromRiders(newRace.uuid);
        const created = useCategoryStore.getState().categories.filter((c) => c.raceUuid === newRace.uuid);
        const imported = useRiderStore.getState().riders.filter((r) => r.raceUuid === newRace.uuid);
        if (imported.length > 0 && created.length === 0) {
          throw new Error("No categories could be created from this file — check that a column is recognised as Category. The race was not saved.");
        }
      } catch (error) {
        console.error("Error saving riders at saveRidersFromCsv", error);
        // Never keep a half-created race: remove only what THIS save created
        // (race first, so the lock no longer protects its riders — AGENTS.md).
        try {
          await useRaceStore.getState().deleteRace(newRace.uuid);
          await useRiderStore.getState().deleteRidersByRace(newRace.uuid);
        } catch (cleanupError) {
          console.error("Could not roll back the new race", cleanupError);
        }
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

    // With a server, a new race exists only once PostgreSQL has it, linked to the
    // signed-in owner. A refusal / no connection removes the local copy again and
    // the form stays open (Done = retry), so no local-only race is created. Only a
    // server that is slow to answer keeps the race (the upload may still land; the
    // queue finishes it — never sent twice, see publishRace).
    let storage: NewRaceStorage | null = null;
    if (import.meta.env.VITE_SERVER_URL) {
      const live = await import("@/services/live/liveClient");
      try {
        storage = await live.persistNewRace(newRace.uuid, 60_000);
      } catch (e) {
        storage = { stored: "device", reason: "failed", message: e instanceof Error ? e.message : String(e) };
      }
      if (storage.stored !== "server" && storage.reason !== "timeout") {
        await live.discardUnsavedNewRace(newRace.uuid);
        throw new Error(`The race was not saved to the server: ${storage.message.replace(/\.$/, "")}. Nothing was kept on this device — check the connection and press Done to try again.`);
      }
    }

    setAddNewwRace(false);
    return storage;
  } catch (error) {

    if (error instanceof Error) {
      console.error("Error saving riders:", error.message);
    } else {
      console.error("Unknown error saving riders:", error);
    }
    throw error;
  }
};
