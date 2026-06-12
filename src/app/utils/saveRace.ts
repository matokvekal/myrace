import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import useRaceStore from "@/stores/racesStore";
import { RaceProps } from "@/types/types";
import { FormEvent } from "react";
import { saveRidersFromCsv } from "./insertRidersCsv";
import { clearRaceState } from "@/utils/clearRaceState";
import Images from "@/constants/Images";
import { generateRaceId } from "@/services/RaceSync";

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
  setAddNewwRace: (value: boolean) => void
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
      level: "1",
      orgenizer: "Race Org",
      manager: "John Doe",
      phone: "000-000-0000",
      takanon: "",
      site: "",
      createdAt: new Date(),
      lastUpdateAt: new Date(),
      isActive: true,
      map: "",
      distance: 0,
    };
    //save to db
    const db = await initIndexedDB();
    await db.add("races", newRace);
    db.close();
    //save to state
    const { insertRace } = useRaceStore.getState();
    await insertRace(newRace);

    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        if (!event.target?.result) return;
        const csvData = event.target.result as string;

        try {
          await saveRidersFromCsv(csvData, newRace.uuid);
        } catch (error) {
          console.error("Error saving riders at saveRidersFromCsv", error);
        }
      };
      reader.readAsText(file); // ✅ Read the file as text (CSV/XLSX)
    }
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
