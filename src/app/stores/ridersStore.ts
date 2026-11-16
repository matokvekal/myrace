import { create } from "zustand";
import { persist } from "zustand/middleware";
import { fetchRiders as fetchRidersFromAPI } from "@/services/fetchRiders";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { RiderProps } from "@/types/types";
import indexedDBStorage from "./indexDb/riderStorageAdapter";
import { shallow } from "zustand/shallow";
import { isRaceUuidFinalized } from "@/utils/raceLock";
import { isApplyingRemote, liveBridge } from "@/services/live/liveBridge";

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
  if (isApplyingRemote()) return false; // shared race: the server's official versions decide
  const locked = [...new Set(riders.map((r) => r.raceUuid))].filter(isRaceUuidFinalized);
  if (locked.length === 0) return false;
  console.warn(`Race ${locked.join(", ")} is finalized — ignored rider ${action}.`);
  return true;
}

/** Shared races: let the live bridge turn a batch update into Actions (or block it). */
function liveCheck(current: RiderProps[], updated: RiderProps[]): boolean {
  const lb = liveBridge();
  if (!lb) return true;
  const byId = new Map(current.map((r) => [r.id, r]));
  const pairs = updated.filter((r) => byId.has(r.id));
  return lb.beforeRiders("update", pairs.map((r) => byId.get(r.id)!), pairs) !== false;
}

/**
 * Same stored content? The cheap fields that change on a lap/status/ranking are checked
 * first; only rows that match on all of them get the full comparison, so a real change
 * is never mistaken for "same" (when in doubt it writes).
 */
export function sameRider(a: RiderProps, b: RiderProps): boolean {
  if (a === b) return true;
  if (
    a.lapsCounter !== b.lapsCounter || a.timeArrive !== b.timeArrive || a.raceStatus !== b.raceStatus ||
    a.status !== b.status || a.position_category !== b.position_category || a.position_race !== b.position_race ||
    a.bibNumber !== b.bibNumber || (a.lapsDetails?.length ?? 0) !== (b.lapsDetails?.length ?? 0)
  ) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** Per race: the latest `getRiders` load started, so an older answer never overwrites a newer one. */
const loadSeq = new Map<string, number>();

/**
 * Local rider writes vs. an in-flight `getRiders` (rc.6 hotfix). A load reads IndexedDB (or the
 * API) asynchronously; a write that lands meanwhile (lap, check-in, edit, remote change, delete)
 * is newer than that snapshot. `getRiders` keeps the in-memory version of every rider written
 * after the load started, or whose IndexedDB write hasn't finished yet.
 */
let writeClock = 0;
const lastWrite = new Map<number, { at: number; deleted: boolean }>();
const pendingWrites = new Map<number, number>();

function beginWrite(ids: number[], deleted = false): () => void {
  const at = ++writeClock;
  for (const id of ids) {
    lastWrite.set(id, { at, deleted });
    pendingWrites.set(id, (pendingWrites.get(id) ?? 0) + 1);
  }
  return () => {
    for (const id of ids) {
      const n = (pendingWrites.get(id) ?? 1) - 1;
      if (n > 0) pendingWrites.set(id, n);
      else pendingWrites.delete(id);
    }
  };
}

/** `loaded` merged with this race's in-memory riders written since the load began at `since`. */
function mergeLoad(raceUuid: string, loaded: RiderProps[], current: RiderProps[], since: number): RiderProps[] {
  const touched = (id: number) => (lastWrite.get(id)?.at ?? 0) > since || pendingWrites.has(id);
  const mem = new Map(current.filter((r) => r.raceUuid === raceUuid).map((r) => [r.id, r]));
  const merged: RiderProps[] = [];
  for (const r of loaded) {
    if (!touched(r.id)) merged.push(r);
    else if (mem.has(r.id)) merged.push(mem.get(r.id)!);
    else if (!lastWrite.get(r.id)?.deleted) merged.push(r); // written to IDB only (not in memory)
  }
  const loadedIds = new Set(loaded.map((r) => r.id));
  for (const r of mem.values()) if (!loadedIds.has(r.id) && touched(r.id)) merged.push(r);
  return merged;
}

interface RiderState {
  riders: RiderProps[];
  lastFetchedRaceUuid: string;
  getRidersOld: (raceUuid: string) => Promise<RiderProps[]>;
  getRiders: (raceUuid: string) => Promise<RiderProps[]>;
  getRidersByHeat: (raceUuid: string, heat: number) => RiderProps[];
  getRidersByCategory: (raceUuid: string, category: string) => RiderProps[];
  updateRider: (updatedRider: RiderProps) => Promise<void>;
  /**
   * `persistIds`: write only these riders to IndexedDB (the in-memory update is the same
   * either way). For a re-ranking where most riders are unchanged clones — see
   * `rankingWrites` in useLapRecording. Omitted = write every rider passed, as before.
   */
  updateAllRiders: (updatedRiders: RiderProps[], persistIds?: ReadonlySet<number>) => Promise<void>;
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
            return riders.filter((r) => r.raceUuid === raceUuid);
          }

          const load = (loadSeq.get(raceUuid) ?? 0) + 1;
          loadSeq.set(raceUuid, load);
          const since = writeClock;
          // Replace ONLY this race's riders, never the other races' (rc.6 hotfix). This used to
          // set `riders` to this race alone, so a background load of another race (My Races'
          // account sync catches up every linked race and each catch-up calls getRiders) wiped
          // the race on screen: "No riders yet" until a remount re-read it. A newer load of the
          // same race that started after this one wins; this older answer is dropped. Riders
          // written locally while it was in flight keep their in-memory version (`mergeLoad`).
          const apply = (loaded: RiderProps[]): RiderProps[] => {
            if (loadSeq.get(raceUuid) !== load) return get().riders.filter((r) => r.raceUuid === raceUuid);
            let merged = loaded;
            set((state) => {
              merged = mergeLoad(raceUuid, loaded, state.riders, since);
              return {
                ...state,
                riders: [...state.riders.filter((r) => r.raceUuid !== raceUuid), ...merged],
                lastFetchedRaceUuid: raceUuid,
              };
            });
            return merged;
          };

          const db = await initIndexedDB();
          let storedRiders = await db.getAll("riders");
          storedRiders = storedRiders.filter((r) => r.raceUuid === raceUuid);

          if (storedRiders.length > 0) {
            const result = apply(storedRiders);
            db.close();
            return result;
          }

          const fetchedRiders = await fetchRidersFromAPI(raceUuid);
          if (fetchedRiders.length > 0) {
            const result = apply(fetchedRiders);
            // Never write a fetched row over a rider changed locally meanwhile.
            const touchedAfter = (id: number) => (lastWrite.get(id)?.at ?? 0) > since || pendingWrites.has(id);
            const toStore = fetchedRiders.filter((r) => !touchedAfter(r.id));

            const tx = db.transaction("riders", "readwrite");
            const store = tx.objectStore("riders");
            await Promise.all(toStore.map((rider) => store.put(rider)));
            await tx.done;
            db.close();
            return result;
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
        if (liveBridge()?.beforeRiders("add", [], [newRider]) === false) return;
        const done = beginWrite([newRider.id]);
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
        } finally {
          done();
        }
      },

      insertRiders: async (newRiders) => {
        if (blockIfFinalized(newRiders, "import")) return;
        if (liveBridge()?.beforeRiders("import", [], newRiders) === false) return;
        const done = beginWrite(newRiders.map((r) => r.id));
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
        } finally {
          done();
        }
      },

      updateRider: async (updatedRider) => {
        if (blockIfFinalized([updatedRider], "update")) return;
        const prev = get().riders.find((r) => r.id === updatedRider.id);
        if (prev && liveBridge()?.beforeRiders("update", [prev], [updatedRider]) === false) return;
        const done = beginWrite([updatedRider.id]);
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
        } finally {
          done();
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
      patchRiders: async (incoming) => {
        // A row identical to what this device already holds (e.g. the server's echo of a
        // lap applied here, or a re-ranking that didn't move this rider) changes nothing:
        // skip it, so it costs no store update, no re-render and no IndexedDB write.
        const current = new Map(get().riders.map((r) => [r.id, r]));
        const updatedRiders = incoming.filter((r) => {
          const c = current.get(r.id);
          return !c || !sameRider(c, r);
        });
        if (updatedRiders.length === 0) return;
        if (blockIfFinalized(updatedRiders, "patch")) return;
        if (!liveCheck(get().riders, updatedRiders)) return;
        const byId = new Map(updatedRiders.map((r) => [r.id, r]));
        const done = beginWrite(updatedRiders.map((r) => r.id));
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
        } finally {
          done();
        }
      },

      updateAllRiders: async (updatedRiders, persistIds) => {
        if (blockIfFinalized(updatedRiders, "update")) return;
        if (!liveCheck(get().riders, updatedRiders)) return;
        const updatedIds = new Set(updatedRiders.map((r) => r.id));
        const done = beginWrite([...updatedIds]);
        set((state) => ({
          ...state,
          riders: [
            ...state.riders.filter((r) => !updatedIds.has(r.id)),
            ...updatedRiders,
          ],
        }));

        const toWrite = persistIds ? updatedRiders.filter((r) => persistIds.has(r.id)) : updatedRiders;
        if (toWrite.length === 0) {
          done();
          return;
        }
        try {
          const db = await initIndexedDB();
          const tx = db.transaction("riders", "readwrite");
          const store = tx.objectStore("riders");
          await Promise.all(toWrite.map((rider) => store.put(rider)));
          await tx.done;
          db.close();
        } catch (error) {
          console.error("Error updating all riders in IDB:", error);
        } finally {
          done();
        }
      },

      deleteRider: async (riderId) => {
        const target = get().riders.find((r) => r.id === riderId);
        if (target && blockIfFinalized([target], "delete")) return;
        if (target && liveBridge()?.beforeRiders("delete", [target], []) === false) return;
        const done = beginWrite([riderId], true);
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
        } finally {
          done();
        }
      },

      deleteRidersByRace: async (raceUuid) => {
        // Deleting the whole RACE is still allowed: `racesStore.deleteRace`
        // removes the race first, so by the time this runs as its cleanup step
        // the uuid is no longer finalized and the purge goes through.
        if (blockIfFinalized([{ raceUuid }], "bulk delete")) return;
        // A load of this race still in flight must not bring the deleted riders back.
        loadSeq.set(raceUuid, (loadSeq.get(raceUuid) ?? 0) + 1);
        let done = () => {};
        try {
          const db = await initIndexedDB();
          const allRiders = await db.getAll("riders");
          const toDelete = allRiders.filter((r: RiderProps) => r.raceUuid === raceUuid);
          done = beginWrite(toDelete.map((r: RiderProps) => r.id), true);
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
        } finally {
          done();
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
