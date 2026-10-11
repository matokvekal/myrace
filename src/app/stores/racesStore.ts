import { create } from "zustand";
import { persist } from "zustand/middleware";
import { fetchRaces as fetchRacesFromAPI } from "@/services/fetchRaces";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { RaceProps, CategoryProps, RiderProps } from "@/types/types";
import raceStorageAdapter from "./indexDb/raceStorageAdapter";

interface RaceState {
   races: RaceProps[];
   getRaces: () => Promise<RaceProps[]>;
   insertRace: (newRace: RaceProps) => Promise<void>;
   updateRace: (updatedRace: RaceProps) => Promise<void>;
   deleteRace: (raceUuid: string) => Promise<void>;
}

/**
 * Fields a FINALIZED race still accepts writes to. Everything here is local
 * bookkeeping that says nothing about the result — a favourite star, sync
 * housekeeping, or the finalization record itself (stamped by
 * `utils/finalizeRace.ts` as its last step, after the riders are saved).
 *
 * Lives here rather than in `utils/raceLock.ts` so that module can import this
 * store without an import cycle.
 */
const FINALIZED_WRITABLE_FIELDS = new Set<keyof RaceProps>([
   "isFavorite",
   "viewOnly",
   "syncedAt",
   "serverVersion",
   "lastUpdateAt",
   "finalized",
]);

/**
 * Which fields an update would actually change on a finalized race, ignoring
 * the harmless ones. Empty array -> the write is safe to let through.
 */
export function blockedFinalizedFields(
   existing: RaceProps,
   incoming: RaceProps
): string[] {
   const keys = new Set([
      ...Object.keys(existing),
      ...Object.keys(incoming),
   ]) as Set<keyof RaceProps>;
   const changed: string[] = [];
   for (const key of keys) {
      if (FINALIZED_WRITABLE_FIELDS.has(key)) continue;
      // Deep-ish compare: map points / markers are arrays, the rest are scalars.
      if (JSON.stringify(existing[key] ?? null) !== JSON.stringify(incoming[key] ?? null)) {
         changed.push(String(key));
      }
   }
   return changed;
}

const useRaceStore = create<RaceState>()(
   persist(
      (set, get) => ({
         races: [],

         getRaces: async () => {
            try {
               let races = get().races;

               if (races.length > 0) {
                  return races;
               }

               const db = await initIndexedDB();
               races = await db.getAll("races");

               if (races.length > 0) {
                  set({ races }); 
                  db.close();
                  return races;
               }

               races = await fetchRacesFromAPI();
               if (races.length > 0) {
                  set({ races }); //  Update Zustand store

                  const tx = db.transaction("races", "readwrite");
                  const store = tx.objectStore("races");

                  for (const race of races) {
                     await store.put(race);     
                  }
                  await tx.done;
               }

               db.close();
               return races;
            } catch (error) {
               console.error("Error in getRaces:", error);
               return [];
            }
         },

         insertRace: async (newRace: RaceProps) => {
            try {
               const { races } = get();
               // Replace if the same race is already cached (e.g. a re-save)
               const updatedRaces = races.some((r) => r.id === newRace.id)
                  ? races.map((r) => (r.id === newRace.id ? newRace : r))
                  : [...races, newRace];

               set({ races: updatedRaces });

               const db = await initIndexedDB();
               // put, not add: add throws ConstraintError if the id already
               // exists, which crashed the save when the row was written twice.
               await db.put("races", newRace);
               db.close();
            } catch (error) {
               console.error("Error inserting race:", error);
            }
         },

         updateRace: async (updatedRace: RaceProps) => {
            try {
               const { races } = get();

               // A finished race is a published result — its details are frozen.
               // Only the local bookkeeping fields above may still move. This is
               // the backstop for any screen that forgot to hide its Edit button.
               const existing = races.find((r) => r.uuid === updatedRace.uuid);
               if (existing?.finalized) {
                  const blocked = blockedFinalizedFields(existing, updatedRace);
                  if (blocked.length > 0) {
                     console.warn(
                        `Race ${existing.uuid} is finalized — ignored change to: ${blocked.join(", ")}`
                     );
                     return;
                  }
               }

               const updatedRaces = races.map((race) =>
                  // race.id === updatedRace.id ? updatedRace : race
               race.uuid === updatedRace.uuid ? updatedRace : race
               );

               set({ races: updatedRaces });

               const db = await initIndexedDB();
               const tx = db.transaction("races", "readwrite");
               const store = tx.objectStore("races");
               await store.put(updatedRace);
               await tx.done;
               db.close();

               console.log("Race updated successfully");
            } catch (error) {
               console.error("Error updating race:", error);
            }
         },

         deleteRace: async (raceUuid) => {
            try {
               const db = await initIndexedDB();

               // Delete riders for this race
               const allRiders = await db.getAll("riders");
               const ridersToDelete = allRiders.filter((r: RiderProps) => r.raceUuid === raceUuid);
               if (ridersToDelete.length > 0) {
                  const riderTx = db.transaction("riders", "readwrite");
                  const riderStore = riderTx.objectStore("riders");
                  await Promise.all(ridersToDelete.map((r: RiderProps) => riderStore.delete(r.id)));
                  await riderTx.done;
               }

               // Delete categories for this race
               const allCats = await db.getAll("categories");
               const catsToDelete = allCats.filter((c: CategoryProps) => c.raceUuid === raceUuid);
               if (catsToDelete.length > 0) {
                  const catTx = db.transaction("categories", "readwrite");
                  const catStore = catTx.objectStore("categories");
                  await Promise.all(catsToDelete.map((c: CategoryProps) => catStore.delete(c.id)));
                  await catTx.done;
               }

               // Delete the race itself
               const allRaces = await db.getAll("races");
               const raceRecord = allRaces.find((r: RaceProps) => r.uuid === raceUuid);
               if (raceRecord) {
                  await db.delete("races", raceRecord.id);
               }

               db.close();
               set((state) => ({
                  races: state.races.filter((r) => r.uuid !== raceUuid),
               }));
            } catch (error) {
               console.error("Error deleting race:", error);
            }
         },
      }),
      {
         name: "race-storage", //  Store Zustand Data
         storage: raceStorageAdapter(), // custom adapter
         partialize: (state) => ({ races: state.races }),
         // onRehydrateStorage: () => async (state) => {
         //    if (!state?.races || state.races.length === 0) {
         //       console.log("Restoring races from IndexedDB...");
         //       const db = await initIndexedDB();
         //       const races = await db.getAll("races");

         //       if (races.length > 0) {
         //          console.log("Restored races from IndexedDB to Zustand store");
         //          useRaceStore.setState({ races }); //  Sync Zustand with IndexedDB
         //       }
         //       db.close();
         //    }
         // },
      }
   )
);

export default useRaceStore;
