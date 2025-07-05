import { openDB } from "idb";
import { PersistStorage } from "zustand/middleware";

const raceStorageAdapter = (): PersistStorage<any> => ({
  getItem: async (name: string) => {
    const db = await openDB("commissireDb", 3, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("races")) {
          db.createObjectStore("races", { keyPath: "id" });  // Set keyPath to 'id'
        }
      },
    });
    const result = await db.get("races", name);
    db.close();
    return result ?? null;
  },
  setItem: async (name: string, value: any) => {

    if (!value || !value.state?.races) {
      console.warn("Invalid data structure, 'races' is missing.");
      return;
    }
    const db = await openDB("commissireDb", 3, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("races")) {
          db.createObjectStore("races", { keyPath: "id" });
        }
      },
    });
    // Remove the extra key parameter and ensure 'value' contains 'id'
    if (Array.isArray(value.state.races)) {

      for (const race of value.state.races) {
        if (race.id) {
          await db.put("races", race);  
        } else {
          console.warn("Skipping race with missing 'id'", race);
        }
      }
    }
    db.close();
  },
  removeItem: async (name: string) => {

    const db = await openDB("commissireDb", 3, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("races")) {
          db.createObjectStore("races", { keyPath: "id" });
        }
      },
    });
    await db.delete("races", name);
    db.close();
  },
});

export default raceStorageAdapter;
