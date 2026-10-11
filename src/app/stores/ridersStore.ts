import { create } from "zustand";
import { persist } from "zustand/middleware";
import { fetchRiders as fetchRidersFromAPI } from "@/services/fetchRiders";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { RiderProps } from "@/types/types";
import indexedDBStorage from "./indexDb/riderStorageAdapter";
import { shallow } from "zustand/shallow";
import { isRaceUuidFinalized } from "@/utils/raceLock";

/**
 * Hard guard for a FINALIZED race (see `utils/raceLock.ts`). Every rider write
 * runs through this, so a screen that forgot to hide its edit control still
 * cannot alter a signed result. `utils/finalizeRace.ts` writes its riders
 * BEFORE stamping the race, so its own close-out is not blocked by this.
 *
 * Takes the riders being written and reports whether the write is blocked;
 * mixed-race batches are rejected only if a finalized race is involved.
 */
function blockIfFinalized(riders: { raceUuid: string }[], action: string): boolean {
  const locked = [...new Set(riders.map((r) => r.raceUuid))].filter(isRaceUuidFinalized);
  if (locked.length === 0) return false;
  console.warn(`Race ${locked.join(", ")} is finalized — ignored rider ${action}.`);
  return true;
}

interface RiderState {
  riders: RiderProps[];
  lastFetchedRaceUuid: string;
  getRidersOld: (raceUuid: string) => Promise<RiderProps[]>;
  getRiders: (raceUuid: string) => Promise<RiderProps[]>;
  getRidersByHeat: (raceUuid: string, heat: number) => RiderProps[];
  getRidersByCategory: (raceUuid: string, category: string) => RiderProps[];
  updateRider: (updatedRider: RiderProps) => Promise<void>;
  updateAllRiders: (updatedRiders: RiderProps[]) => Promise<void>;
  patchRiders: (updatedRiders: RiderProps[]) => Promise<void>;
  insertRiders: (newRiders: RiderProps[]) => Promise<void>;
  addNewRider: (newRider: RiderProps) => Promise<void>;
  deleteRider: (riderId: number) => Promise<void>;
  deleteRidersByRace: (raceUuid: string) => Promise<void>;
}

/**
 * Rider Store with enhanced filtering capabilities
 * 
 * Usage examples:
 * 
 * // Get all riders for a race
 * const { riders, getRiders } = useRiderStore();
 * await getRiders("race-uuid-123");
 * 
 * // Get riders by race and heat
 * const { getRidersByRaceAndHeat } = useRiderStore();
 * const heatRiders = getRidersByRaceAndHeat("race-uuid-123", 2);
 * 
 * // Get riders by race and category
 * const { getRidersByRaceAndCategory } = useRiderStore();
 * const categoryRiders = getRidersByRaceAndCategory("race-uuid-123", "Men Elite");
 */

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

      getRidersByHeat: (raceUuid: string, heat: number) => {
        const { riders } = get();
        return riders.filter(rider =>
          rider.raceUuid === raceUuid && rider.heat === heat
        );
      },

      getRidersByCategory: (raceUuid: string, category: string) => {
        const { riders } = get();
        return riders.filter(rider =>
          rider.raceUuid === raceUuid && rider.category === category
        );
      },

      addNewRider: async (newRider) => {
        if (blockIfFinalized([newRider], "add")) return;
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
        if (blockIfFinalized(newRiders, "import")) return;
        try {
          set((state) => ({
            ...state,
            riders: [...state.riders, ...newRiders],
            // Mark the imported race as loaded so the next `getRiders` for it
            // serves the cache. Without this the cache guard stays off after an
            // import and EVERY screen that mounts re-reads `db.getAll("riders")`
            // — an async snapshot that replaces the whole array and can revert
            // edits made while it was in flight (check-ins silently unticking).
            lastFetchedRaceUuid:
              newRiders[0]?.raceUuid ?? state.lastFetchedRaceUuid,
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
        if (blockIfFinalized([updatedRider], "update")) return;
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

      /**
       * Batch update that PRESERVES the existing array order, in ONE store set
       * and ONE IDB transaction.
       *
       * Use this for bulk screen actions (e.g. Check-in "Check all"). Looping
       * `updateRider` instead costs an openDB + transaction PER rider, and the
       * `persist` middleware re-writes the whole riders array after every one
       * of those sets — O(n²) puts, which freezes the UI on a real start list
       * and leaves a wide window for a stale `getRiders` read to overwrite the
       * result.
       *
       * Differs from `updateAllRiders`, which moves the updated riders to the
       * END of the array — the heat screen depends on that to apply a new sort
       * order, so don't "simplify" the two into one.
       */
      patchRiders: async (updatedRiders) => {
        if (updatedRiders.length === 0) return;
        if (blockIfFinalized(updatedRiders, "patch")) return;
        const byId = new Map(updatedRiders.map((r) => [r.id, r]));
        set((state) => ({
          ...state,
          riders: state.riders.map((r) => byId.get(r.id) ?? r),
        }));

        try {
          const db = await initIndexedDB();
          const tx = db.transaction("riders", "readwrite");
          const store = tx.objectStore("riders");
          await Promise.all(updatedRiders.map((rider) => store.put(rider)));
          await tx.done;
          db.close();
        } catch (error) {
          console.error("Error patching riders in IDB:", error);
        }
      },

      updateAllRiders: async (updatedRiders) => {
        if (blockIfFinalized(updatedRiders, "update")) return;
        const updatedIds = new Set(updatedRiders.map((r) => r.id));
        set((state) => ({
          ...state,
          riders: [
            ...state.riders.filter((r) => !updatedIds.has(r.id)),
            ...updatedRiders,
          ],
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

      deleteRider: async (riderId) => {
        const target = get().riders.find((r) => r.id === riderId);
        if (target && blockIfFinalized([target], "delete")) return;
        try {
          set((state) => ({
            ...state,
            riders: state.riders.filter((r) => r.id !== riderId),
          }));
          const db = await initIndexedDB();
          const tx = db.transaction("riders", "readwrite");
          await tx.objectStore("riders").delete(riderId);
          await tx.done;
          db.close();
        } catch (error) {
          console.error("Error deleting rider:", error);
        }
      },

      deleteRidersByRace: async (raceUuid) => {
        // Deleting the whole RACE is still allowed: `racesStore.deleteRace`
        // removes the race first, so by the time this runs as its cleanup step
        // the uuid is no longer finalized and the purge goes through.
        if (blockIfFinalized([{ raceUuid }], "bulk delete")) return;
        try {
          const db = await initIndexedDB();
          const allRiders = await db.getAll("riders");
          const toDelete = allRiders.filter((r: RiderProps) => r.raceUuid === raceUuid);
          if (toDelete.length > 0) {
            const tx = db.transaction("riders", "readwrite");
            const store = tx.objectStore("riders");
            await Promise.all(toDelete.map((r: RiderProps) => store.delete(r.id)));
            await tx.done;
          }
          db.close();
          set((state) => ({
            riders: state.riders.filter((r) => r.raceUuid !== raceUuid),
          }));
        } catch (error) {
          console.error("Error deleting riders by race:", error);
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
