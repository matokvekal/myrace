import { openDB, IDBPDatabase } from "idb";
import { RiderProps, RaceProps, CategoryProps } from "@/types/types";
import { Role, User } from "@/types/rbac.types";
import type { RaceEvent, SyncStatus } from "@/types/cloud.types";

const DB_NAME = "commissireDb";
const DB_VERSION = 10; // v10: live_outbox for shared (multi-user) races

// Every store the app reads/writes. Used to sanity-check a recovered DB.
const REQUIRED_STORES = ["riders", "categories", "races", "roles", "users", "race_events", "live_outbox"];

function createStores(db: IDBPDatabase) {
  if (!db.objectStoreNames.contains("riders")) db.createObjectStore("riders", { keyPath: "id" });
  if (!db.objectStoreNames.contains("categories")) db.createObjectStore("categories", { keyPath: "id" });
  if (!db.objectStoreNames.contains("races")) db.createObjectStore("races", { keyPath: "id" });
  if (!db.objectStoreNames.contains("roles")) db.createObjectStore("roles", { keyPath: "id" });
  if (!db.objectStoreNames.contains("users")) db.createObjectStore("users", { keyPath: "id" });
  if (!db.objectStoreNames.contains("race_events")) {
    const store = db.createObjectStore("race_events", { keyPath: "id" });
    store.createIndex("byRace", "raceId");
    store.createIndex("bySyncStatus", "syncStatus");
  }
  // Shared races: Actions written here BEFORE the UI shows them, removed once
  // the server acknowledges them (AD-4). Each entry keeps its race (AD-20).
  if (!db.objectStoreNames.contains("live_outbox")) {
    const store = db.createObjectStore("live_outbox", { keyPath: "actionId" });
    store.createIndex("byRace", "localRaceUuid");
  }
}

/**
 * Health of the local database as seen by this app version.
 * "needs-update" = the saved database is newer than this app and is missing a
 * store this version expects, or could not be opened. Data is never deleted in
 * that case; the user is asked to update the app (see DbUpdateNotice).
 */
export type DbHealth = "ok" | "needs-update";

let dbHealth: DbHealth = "ok";
const dbHealthListeners = new Set<() => void>();

export const getDbHealth = (): DbHealth => dbHealth;

export const subscribeDbHealth = (listener: () => void): (() => void) => {
  dbHealthListeners.add(listener);
  return () => {
    dbHealthListeners.delete(listener);
  };
};

function markDbNeedsUpdate() {
  if (dbHealth === "needs-update") return;
  dbHealth = "needs-update";
  dbHealthListeners.forEach((listener) => listener());
}

export const initIndexedDB = async (): Promise<IDBPDatabase> => {
  try {
    return await openDB(DB_NAME, DB_VERSION, { upgrade: createStores });
  } catch (err: any) {
    if (err?.name !== "VersionError") throw err;
    // The stored DB is NEWER than this bundle — happens when an older cached
    // build loads after a newer deploy. Open it at whatever version is on disk
    // and keep every byte of race data (BUG-02; AGENTS.md policy: never delete or
    // reset a database holding race data as a recovery mechanism). If it lacks a
    // store this version expects, reads from that store fail (callers already
    // treat that as empty) and the user is asked to update the app.
    let existing: IDBPDatabase;
    try {
      existing = await openDB(DB_NAME);
    } catch (openErr) {
      markDbNeedsUpdate();
      throw openErr;
    }
    const hasAll = REQUIRED_STORES.every((s) => existing.objectStoreNames.contains(s));
    if (!hasAll) markDbNeedsUpdate();
    return existing;
  }
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

// ============================================================================
// RBAC - Roles Management
// ============================================================================

// Get all roles from IndexedDB
export const getAllRolesFromDb = async (): Promise<Role[]> => {
  try {
    const db = await initIndexedDB();
    const allRoles = await db.getAll("roles");
    db.close();
    return allRoles || [];
  } catch (error) {
    console.error("Error fetching roles from IndexedDB:", error);
    return [];
  }
};

// Add a single role to IndexedDB
export const addRoleToDb = async (newRole: Role): Promise<void> => {
  try {
    const db = await initIndexedDB();
    await db.add("roles", newRole);
    db.close();
  } catch (error) {
    console.error("Error adding role to IndexedDB:", error);
  }
};

// Update an existing role in IndexedDB
export const updateRoleInDb = async (updatedRole: Role): Promise<void> => {
  try {
    const db = await initIndexedDB();
    await db.put("roles", updatedRole);
    db.close();
  } catch (error) {
    console.error("Error updating role in IndexedDB:", error);
  }
};

// Delete a role from IndexedDB
export const deleteRoleFromDb = async (roleId: string): Promise<void> => {
  try {
    const db = await initIndexedDB();
    await db.delete("roles", roleId);
    db.close();
  } catch (error) {
    console.error("Error deleting role from IndexedDB:", error);
  }
};

// ============================================================================
// RBAC - Users Management
// ============================================================================

// Get all users from IndexedDB
export const getAllUsersFromDb = async (): Promise<User[]> => {
  try {
    const db = await initIndexedDB();
    const allUsers = await db.getAll("users");
    db.close();
    return allUsers || [];
  } catch (error) {
    console.error("Error fetching users from IndexedDB:", error);
    return [];
  }
};

// Add a single user to IndexedDB
export const addUserToDb = async (newUser: User): Promise<void> => {
  try {
    const db = await initIndexedDB();
    await db.add("users", newUser);
    db.close();
  } catch (error) {
    console.error("Error adding user to IndexedDB:", error);
  }
};

// Update an existing user in IndexedDB
export const updateUserInDb = async (updatedUser: User): Promise<void> => {
  try {
    const db = await initIndexedDB();
    await db.put("users", updatedUser);
    db.close();
  } catch (error) {
    console.error("Error updating user in IndexedDB:", error);
  }
};

// Delete a user from IndexedDB
export const deleteUserFromDb = async (userId: string): Promise<void> => {
  try {
    const db = await initIndexedDB();
    await db.delete("users", userId);
    db.close();
  } catch (error) {
    console.error("Error deleting user from IndexedDB:", error);
  }
};

// ============================================================================
// Cloud Sync - Race Events Log (v9)
// ============================================================================

// Add or replace a race event
export const putRaceEventInDb = async (event: RaceEvent): Promise<void> => {
  try {
    const db = await initIndexedDB();
    await db.put("race_events", event);
    db.close();
  } catch (error) {
    console.error("Error saving race event to IndexedDB:", error);
  }
};

// Get all events for a race (local uuid)
export const getRaceEventsFromDb = async (raceUuid: string): Promise<RaceEvent[]> => {
  try {
    const db = await initIndexedDB();
    const events = await db.getAllFromIndex("race_events", "byRace", raceUuid);
    db.close();
    return events || [];
  } catch (error) {
    console.error("Error fetching race events from IndexedDB:", error);
    return [];
  }
};

// Get events waiting to be pushed to the cloud
export const getPendingEventsFromDb = async (raceUuid?: string): Promise<RaceEvent[]> => {
  try {
    const db = await initIndexedDB();
    const pending: RaceEvent[] = await db.getAllFromIndex(
      "race_events",
      "bySyncStatus",
      "pending"
    );
    db.close();
    return raceUuid ? pending.filter((e) => e.raceId === raceUuid) : pending;
  } catch (error) {
    console.error("Error fetching pending events from IndexedDB:", error);
    return [];
  }
};

// Check if an event id already exists (dedupe for realtime merge)
export const raceEventExistsInDb = async (eventId: string): Promise<boolean> => {
  try {
    const db = await initIndexedDB();
    const found = await db.get("race_events", eventId);
    db.close();
    return Boolean(found);
  } catch (error) {
    console.error("Error checking race event in IndexedDB:", error);
    return false;
  }
};

// Update the sync status of one event
export const setRaceEventStatusInDb = async (
  eventId: string,
  syncStatus: SyncStatus
): Promise<void> => {
  try {
    const db = await initIndexedDB();
    const event = await db.get("race_events", eventId);
    if (event) {
      await db.put("race_events", { ...event, syncStatus });
    }
    db.close();
  } catch (error) {
    console.error("Error updating race event status in IndexedDB:", error);
  }
};