import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import useRaceStore from "@/stores/racesStore";
import { RaceProps } from "@/types/types";
import { FormEvent } from "react";
import { raceValidateText } from "@/utils/textValidation";
import { saveRidersFromCsv } from "./insertRidersCsv";
import { clearRaceState } from "@/utils/clearRaceState";
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
  file: File | null,
  setAddNewwRace: (value: boolean) => void
) => {
  event.preventDefault();


  try {
    const errorMessage = raceValidateText(raceName);
    clearRaceState();

    const newRace: RaceProps = {
      id: Date.now(),
      uuid: crypto.randomUUID(),
      owner: "1", // This should be dynamically assigned based on the user
      name: raceName,
      location,
      time: "08:00", // Default or user-inputted
      date: startDate,
      image: "default-race.png", // Placeholder for an actual image
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
