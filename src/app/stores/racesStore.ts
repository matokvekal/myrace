import { create } from "zustand";
import { persist } from "zustand/middleware";
import { fetchRaces as fetchRacesFromAPI } from "@/services/fetchRaces";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { RaceProps } from "@/types/types";
import raceStorageAdapter from "./indexDb/raceStorageAdapter";

interface RaceState {
   races: RaceProps[];
   getRaces: () => Promise<RaceProps[]>;
   insertRace: (newRace: RaceProps) => Promise<void>;
   updateRace: (updatedRace: RaceProps) => Promise<void>;
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
               const updatedRaces = [...races, newRace];

               set({ races: updatedRaces });

               const db = await initIndexedDB();
               await db.add("races", newRace);
               db.close();
            } catch (error) {
               console.error("Error inserting race:", error);
            }
         },

         updateRace: async (updatedRace: RaceProps) => {
            try {
               const { races } = get();
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
