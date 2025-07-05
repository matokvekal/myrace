import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import useRiderStore from "@/stores/ridersStore";
import { RiderProps } from "@/types/types";
import Papa from "papaparse";
// import riderType from "@/types/riderType";

export const saveRidersFromCsv = async (csvData: string, raceUuid: string) => {
   try {
      debugger
      // Parse CSV file while ignoring the first row
      const parsed = Papa.parse<string[]>(csvData, {
         skipEmptyLines: true,
      });

      if (!parsed || !parsed.data || parsed.data.length < 2) {
         throw new Error("Invalid or empty CSV file.");
      }
      // Extract headers and validate
      const headers = parsed.data[0];
      const expectedHeaders = [
         "timeStartRace",
         "heat",
         "bibNumber",
         "position_start",
         "firstName",
         "lastName",
         "category",
         "team",
         "totalLaps"
      ];

      if (!expectedHeaders.every((header) => headers.includes(header))) {
         console.warn("CSV headers do not match expected format.");
      }
      // Process rows (ignore header row)
      const riders: RiderProps[] = parsed.data.slice(1).map((row, index) => ({
         id: Date.now() + index, // Unique ID
         raceUuid,
         timeStartRace: row[0] || null, // timeStartRace
         heat: parseInt(row[1]),
         bibNumber: parseInt(row[2]) || 0, // bibNumber
         position_start: parseInt(row[3]) || null, // position_start
         firstName: row[4] || "",
         lastName: row[5] || "",
         category: row[6] || "",
         team: row[7] || null, // team (optional)
         totalLaps: parseInt(row[8]) || 0, // totalLaps (optional)
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
         viewOrder: 0,
         color: null,
         elapsedLastLap: null,
         status: "",
         image: null,
         comment: null,
      }));

      // Save riders to IndexedDB
      const db = await initIndexedDB();
      for (const rider of riders) {
         await db.add("riders", rider);
      }
      db.close();

      const { insertRiders } = useRiderStore.getState();
      await insertRiders(riders);
   } catch (error) {
      if (error instanceof Error) {
         console.error("Error saving riders:", error.message);
      } else {
         console.error("Unknown error saving riders:", error);
      }
      throw error;
   }
};

