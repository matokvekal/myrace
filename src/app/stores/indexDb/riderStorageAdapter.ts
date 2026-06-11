import { PersistStorage } from "zustand/middleware";
import { initIndexedDB } from "./indexedDbHelper";

const riderStorageAdapter = (): PersistStorage<any> => ({
  getItem: async (_name: string) => {
    const db = await initIndexedDB();
    const riders = await db.getAll("riders");
    db.close();
    if (!riders.length) return null;
    return { state: { riders } };
  },
  setItem: async (_name: string, value: any) => {
    const riders = value?.state?.riders;
    if (!Array.isArray(riders) || !riders.length) return;
    const db = await initIndexedDB();
    const tx = db.transaction("riders", "readwrite");
    const store = tx.objectStore("riders");
    for (const rider of riders) {
      if (rider.id != null) await store.put(rider);
    }
    await tx.done;
    db.close();
  },
  removeItem: async (_name: string) => {
    const db = await initIndexedDB();
    const tx = db.transaction("riders", "readwrite");
    await tx.objectStore("riders").clear();
    await tx.done;
    db.close();
  },
});

export default riderStorageAdapter;
