import { openDB } from "idb";
import { PersistStorage } from "zustand/middleware";

const categoryStorageAdapter = (): PersistStorage<any> => ({
   getItem: async (name: string) => {
      const db = await openDB("commissireDb", 3, {
         upgrade(db) {
            if (!db.objectStoreNames.contains("categories")) {
               db.createObjectStore("categories", { keyPath: "id" });
            }
         },
      });
      const result = await db.get("categories", name);
      db.close();
      return result ?? null;
   },
   setItem: async (name: string, value: any) => {
      const db = await openDB("commissireDb", 3, {
         upgrade(db) {
            if (!db.objectStoreNames.contains("categories")) {
               db.createObjectStore("categories", { keyPath: "id" });
            }
         },
      });

      // Remove the extra 'name' key parameter
      await db.put("categories", value); 
      db.close();
   },
   removeItem: async (name: string) => {
      const db = await openDB("commissireDb", 3, {
         upgrade(db) {
            if (!db.objectStoreNames.contains("categories")) {
               db.createObjectStore("categories", { keyPath: "id" });
            }
         },
      });
      await db.delete("categories", name);
      db.close();
   },
});

export default categoryStorageAdapter;
