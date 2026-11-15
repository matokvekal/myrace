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
  /**
   * Intentionally writes nothing (perf, 2026-11-15). The persist middleware calls this on
   * EVERY store update with the whole riders array, so each lap rewrote the entire race
   * (~1,000-2,000 puts per tap with 500 riders) and IndexedDB fell minutes behind.
   * Every rider-store action already writes exactly the riders it changes, in its own
   * transaction (see ridersStore), and every direct `useRiderStore.setState` caller
   * persists on its own. `getItem` (start-up hydration) is unchanged.
   */
  setItem: async () => {},
  removeItem: async (_name: string) => {
    const db = await initIndexedDB();
    const tx = db.transaction("riders", "readwrite");
    await tx.objectStore("riders").clear();
    await tx.done;
    db.close();
  },
});

export default riderStorageAdapter;
