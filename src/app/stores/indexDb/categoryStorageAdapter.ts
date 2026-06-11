import { PersistStorage } from "zustand/middleware";
import { initIndexedDB } from "./indexedDbHelper";

const categoryStorageAdapter = (): PersistStorage<any> => ({
  getItem: async (_name: string) => {
    const db = await initIndexedDB();
    const categories = await db.getAll("categories");
    db.close();
    if (!categories.length) return null;
    return { state: { categories } };
  },
  setItem: async (_name: string, value: any) => {
    const db = await initIndexedDB();
    const categories = value?.state?.categories;
    if (Array.isArray(categories)) {
      const tx = db.transaction("categories", "readwrite");
      const store = tx.objectStore("categories");
      for (const cat of categories) {
        if (cat.id != null) await store.put(cat);
      }
      await tx.done;
    }
    db.close();
  },
  removeItem: async (_name: string) => {
    const db = await initIndexedDB();
    const tx = db.transaction("categories", "readwrite");
    await tx.objectStore("categories").clear();
    await tx.done;
    db.close();
  },
});

export default categoryStorageAdapter;
