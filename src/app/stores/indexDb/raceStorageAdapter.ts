import { PersistStorage } from "zustand/middleware";
import { initIndexedDB } from "./indexedDbHelper";

const raceStorageAdapter = (): PersistStorage<any> => ({
  getItem: async (_name: string) => {
    const db = await initIndexedDB();
    const races = await db.getAll("races");
    db.close();
    if (!races.length) return null;
    return { state: { races } };
  },
  setItem: async (_name: string, value: any) => {
    const races = value?.state?.races;
    if (!Array.isArray(races) || !races.length) return;
    const db = await initIndexedDB();
    const tx = db.transaction("races", "readwrite");
    const store = tx.objectStore("races");
    for (const race of races) {
      if (race.id != null) await store.put(race);
    }
    await tx.done;
    db.close();
  },
  removeItem: async (_name: string) => {
    const db = await initIndexedDB();
    const tx = db.transaction("races", "readwrite");
    await tx.objectStore("races").clear();
    await tx.done;
    db.close();
  },
});

export default raceStorageAdapter;
