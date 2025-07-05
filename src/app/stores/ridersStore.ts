import { create } from "zustand";
import { persist } from "zustand/middleware";
import { fetchRiders as fetchRidersFromAPI } from "@/services/fetchRiders";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { RiderProps } from "@/types/types";
import indexedDBStorage from "./indexDb/riderStorageAdapter";
import { shallow } from "zustand/shallow";

interface RiderState {
  riders: RiderProps[];
  lastFetchedRaceUuid: string;
  getRidersOld: (raceUuid: string) => Promise<RiderProps[]>;
  getRiders: (raceUuid: string) => Promise<RiderProps[]>;
  updateRider: (updatedRider: RiderProps) => Promise<void>;
  updateAllRiders: (updatedRiders: RiderProps[]) => Promise<void>;
  insertRiders: (newRiders: RiderProps[]) => Promise<void>;
  addNewRider: (newRider: RiderProps) => Promise<void>;
}

const useRiderStore = create<RiderState>()(
  persist(
    (set, get) => ({
      riders: [],
      lastFetchedRaceUuid: "",

      getRidersOld: async (raceUuid) => {
        try {
          const { riders } = get();
          if (riders.length > 0) return riders;

          const db = await initIndexedDB();
          let storedRiders = await db.getAll("riders");
          storedRiders = storedRiders.filter((r) => r.raceUuid === raceUuid);

          if (storedRiders.length > 0) {
            set({ riders: storedRiders });
            db.close();
            return storedRiders;
          }

          const fetchedRiders = await fetchRidersFromAPI(raceUuid);
          if (fetchedRiders.length > 0) {
            set({ riders: fetchedRiders });

            const tx = db.transaction("riders", "readwrite");
            const store = tx.objectStore("riders");
            await Promise.all(fetchedRiders.map((rider) => store.add(rider)));
            await tx.done;
          }

          db.close();
          return fetchedRiders;
        } catch (error) {
          console.error("Error in getRidersOld:", error);
          return [];
        }
      },

      getRiders: async (raceUuid) => {
        try {
          const { riders, lastFetchedRaceUuid } = get();

          // ✅ Prevent redundant API calls
          if (riders.length > 0 && lastFetchedRaceUuid === raceUuid) {
            console.log("Returning cached riders");
            return riders;
          }

          const db = await initIndexedDB();
          let storedRiders = await db.getAll("riders");
          storedRiders = storedRiders.filter((r) => r.raceUuid === raceUuid);

          if (storedRiders.length > 0) {
            set((state) => ({
              ...state,
              riders: storedRiders,
              lastFetchedRaceUuid: raceUuid,
            }));
            db.close();
            return storedRiders;
          }

          console.log("Fetching riders from API...");
          const fetchedRiders = await fetchRidersFromAPI(raceUuid);
          if (fetchedRiders.length > 0) {
            set((state) => ({
              ...state,
              riders: fetchedRiders,
              lastFetchedRaceUuid: raceUuid,
            }));

            const tx = db.transaction("riders", "readwrite");
            const store = tx.objectStore("riders");
            await Promise.all(fetchedRiders.map((rider) => store.put(rider)));
            await tx.done;
          }

          db.close();
          return fetchedRiders;
        } catch (error) {
          console.error("Error in getRiders:", error);
          return [];
        }
      },

      addNewRider: async (newRider) => {
        try {
          set((state) => ({
            ...state,
            riders: [...state.riders, newRider],
          }));

          const db = await initIndexedDB();
          const tx = db.transaction("riders", "readwrite");
          const store = tx.objectStore("riders");
          await store.put(newRider);
          await tx.done;
          db.close();
        } catch (error) {
          console.error("Error inserting rider:", error);
        }
      },

      insertRiders: async (newRiders) => {
        try {
          set((state) => ({
            ...state,
            riders: [...state.riders, ...newRiders],
          }));

          const db = await initIndexedDB();
          const tx = db.transaction("riders", "readwrite");
          const store = tx.objectStore("riders");
          await Promise.all(newRiders.map((rider) => store.put(rider)));
          await tx.done;
          db.close();
        } catch (error) {
          console.error("Error inserting riders:", error);
        }
      },

      updateRider: async (updatedRider) => {
        try {
          set((state) => ({
            ...state,
            riders: state.riders.map((rider) =>
              rider.id === updatedRider.id ? updatedRider : rider
            ),
          }));

          const db = await initIndexedDB();
          const tx = db.transaction("riders", "readwrite");
          const store = tx.objectStore("riders");
          await store.put(updatedRider);
          await tx.done;
          db.close();
        } catch (error) {
          console.error("Error updating rider in IDB:", error);
        }
      },

      updateAllRiders: async (updatedRiders) => {
        set((state) => ({
          ...state,
          riders: updatedRiders,
        }));

        try {
          const db = await initIndexedDB();
          const tx = db.transaction("riders", "readwrite");
          const store = tx.objectStore("riders");
          await Promise.all(updatedRiders.map((rider) => store.put(rider)));
          await tx.done;
          db.close();
        } catch (error) {
          console.error("Error updating all riders in IDB:", error);
        }
      },
    }),
    {
      name: "rider-storage",
      storage: indexedDBStorage(),
    }
  )
);

export default useRiderStore;
