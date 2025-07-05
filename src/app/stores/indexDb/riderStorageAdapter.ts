import { openDB } from "idb";
import { PersistStorage } from "zustand/middleware";

const riderStorageAdapter = (): PersistStorage<any> => ({
  getItem: async (name: string) => {
    const db = await openDB("commissireDb", 3, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("riders")) {
          db.createObjectStore("riders", { keyPath: "id" });
        }
      },
    });
    const result = await db.get("riders", name);
    db.close();
    return result ?? null;
  },
  setItem: async (name: string, value: any) => {

    if (!value.state.races?.length) return;
    const db = await openDB("commissireDb", 3, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("riders")) {
          db.createObjectStore("riders", { keyPath: "id" });
        }
      },
    });


    if (Array.isArray(value.state?.races)) {
      // Store each rider separately
      for (const rider of value.state.races) {
        if (rider.id) {
          await db.put("riders", rider); 
        } else {
          console.warn("Skipping rider with missing 'id'", rider);
        }
      }
    }
    db.close();
  },
  removeItem: async (name: string) => {
    const db = await openDB("commissireDb", 3, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("riders")) {
          db.createObjectStore("riders", { keyPath: "id" });
        }
      },
    });
    await db.delete("riders", name);
    db.close();
  },
});

export default riderStorageAdapter;
