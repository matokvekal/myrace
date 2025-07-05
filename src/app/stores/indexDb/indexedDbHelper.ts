
import { openDB, IDBPDatabase } from "idb";
import { RiderProps, RaceProps, CategoryProps } from "@/types/types";

const DB_NAME = "commissireDb";
const DB_VERSION = 5;


export const initIndexedDB = async (): Promise<IDBPDatabase> => {
  return openDB("commissireDb", DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {

      if (!db.objectStoreNames.contains("riders")) {
        db.createObjectStore("riders", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("categories")) {
        db.createObjectStore("categories", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("races")) {
        db.createObjectStore("races", { keyPath: "id" });
      }
    },
  });
};
// Fetch all races from IndexedDB
export const getAllRacesFromDb = async (): Promise<RaceProps[]> => {
  try {
    const db = await initIndexedDB();
    const allRaces = await db.getAll("races");
    db.close();
    return allRaces || [];
  } catch (error) {
    console.error("Error fetching races from IndexedDB:", error);
    return [];
  }
};

// Insert a single race into IndexedDB
export const addRaceToDb = async (newRace: RaceProps): Promise<void> => {
  try {
    const db = await initIndexedDB();
    await db.add("races", newRace);
    db.close();
  } catch (error) {
    console.error("Error adding race to IndexedDB:", error);
  }
};

// Bulk insert races into IndexedDB
export const bulkAddRacesToDb = async (races: RaceProps[]): Promise<void> => {
  try {
    const db = await initIndexedDB();
    const tx = db.transaction("races", "readwrite");
    const store = tx.objectStore("races");
    for (const race of races) {
      await store.add(race);
    }
    await tx.done;
    db.close();
  } catch (error) {
    console.error("Error bulk adding races to IndexedDB:", error);
  }
};

// Update an existing race in IndexedDB
export const updateRaceInDb = async (updatedRace: RaceProps): Promise<void> => {
  try {
    const db = await initIndexedDB();
    await db.put("races", updatedRace);
    db.close();
  } catch (error) {
    console.error("Error updating race in IndexedDB:", error);
  }
};
export const getAllRidersFromDb = async (): Promise<RiderProps[]> => {
  try {
    const db = await initIndexedDB();
    const allRiders = await db.getAll("riders");
    db.close();
    return allRiders || [];
  } catch (error) {
    console.error("Error fetching riders from IndexedDB:", error);
    return [];
  }
};

// Insert a single rider into IndexedDB
export const addRiderToDb = async (newRider: RiderProps): Promise<void> => {
  try {
    const db = await initIndexedDB();
    await db.add("riders", newRider);
    db.close();
  } catch (error) {
    console.error("Error adding rider to IndexedDB:", error);
  }
};

// Bulk insert riders into IndexedDB
export const bulkAddRidersToDb = async (riders: RiderProps[]): Promise<void> => {
  try {
    const db = await initIndexedDB();
    const tx = db.transaction("riders", "readwrite");
    const store = tx.objectStore("riders");
    for (const rider of riders) {
      await store.put(rider);
    }
    await tx.done;
    db.close();
  } catch (error) {
    console.error("Error bulk adding riders to IndexedDB:", error);
  }
};

// Update an existing rider in IndexedDB
export const updateRiderInDb = async (updatedRider: RiderProps): Promise<void> => {
  try {
    const db = await initIndexedDB();
    await db.put("riders", updatedRider);
    db.close();
  } catch (error) {
    console.error("Error updating rider in IndexedDB:", error);
  }
};