// src/stores/useCategoryStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { CategoryProps, RiderProps, RaceProps } from "@/types/types";
import { assignCategoryColors } from "@/utils/colorAssignment";
import categoryStorageAdapter from "./indexDb/categoryStorageAdapter";
import { COLORS } from "@/constants/index";
import useRiderStore from "./ridersStore";
import { isRaceUuidFinalized } from "@/utils/raceLock";

/**
 * Hard guard for a FINALIZED race — the category twin of the rider guard in
 * `ridersStore.ts`. See `utils/raceLock.ts` for why the lock is enforced down
 * here and not only in the UI.
 */
function blockIfFinalized(cats: { raceUuid: string }[], action: string): boolean {
  const locked = [...new Set(cats.map((c) => c.raceUuid))].filter(isRaceUuidFinalized);
  if (locked.length === 0) return false;
  console.warn(`Race ${locked.join(", ")} is finalized — ignored category ${action}.`);
  return true;
}

interface CategoryState {
  categories: CategoryProps[];
  getCategories: (raceUuid: string) => Promise<CategoryProps[]>;
  createCategoriesFromRiders: (raceUuid: string) => Promise<void>;
  rebuildCategoriesFromRiders: (raceUuid: string) => Promise<void>;
  updateRiderColor: (categoryName: string, color: string, raceUuid: string) => Promise<void>;
  updateCategory: (updatedCategory: CategoryProps) => void;
  upsertCategories: (cats: CategoryProps[]) => Promise<void>;
}

const useCategoryStore = create<CategoryState>()(
  persist(
    (set, get) => ({
      categories: [],

      getCategories: async (raceUuid) => {
        try {
          let categories = get().categories.filter((c) => c.raceUuid === raceUuid);
          if (categories.length > 0) {
            return categories;
          }

          // 1. Check IndexedDB first
          const db = await initIndexedDB();
          categories = await db.getAll("categories");
          categories = categories.filter((c) => c.raceUuid === raceUuid);

          if (categories.length > 0) {
            set({ categories });
            db.close();
            return categories;
          }

          // 2. If IndexedDB is empty, create categories dynamically from riders
          await get().createCategoriesFromRiders(raceUuid);

          // Ensure getCategories always returns CategoryProps[]
          categories = get().categories.filter((c) => c.raceUuid === raceUuid);
          return categories;
        } catch (error) {
          console.error("Error in getCategories:", error);
          return [];
        }
      },

      // Deliberately NOT guarded for finalized races: this only ever runs when
      // a race has zero categories, as a derive-from-riders recovery. Blocking
      // it would leave a finalized race with nothing to group its results by.
      createCategoriesFromRiders: async (raceUuid) => {
        try {
          const normTime = (t: string | null | undefined): string | null => {
            if (!t) return null;
            const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
            if (!m) return null;
            const hhmm = `${m[1].padStart(2, "0")}:${m[2]}`;
            // Keep non-zero seconds: 08:22:30 is its own start, not 08:22
            return m[3] && m[3] !== "00" ? `${hhmm}:${m[3]}` : hhmm;
          };

          const db = await initIndexedDB();
          let riders: RiderProps[] = await db.getAll("riders");

          // Remember the order categories first appear in the uploaded file (rider ids
          // ascend with row order) before the name sort below discards it.
          const fileOrder = new Map<string, number>();
          [...riders]
            .filter((rider) => rider.raceUuid === raceUuid && rider.category)
            .sort((a, b) => a.id - b.id)
            .forEach((rider) => {
              const key = rider.subCategory ? `${rider.category}::${rider.subCategory}` : rider.category;
              if (!fileOrder.has(key)) fileOrder.set(key, fileOrder.size);
            });

          // Filter riders by raceUuid and sort them
          riders = riders
            .filter((rider) => rider.raceUuid === raceUuid)
            .sort((a, b) => {
              const categoryOrder = a.category.localeCompare(b.category);
              if (categoryOrder !== 0) return categoryOrder;
              const timeA = a.timeStartRace ? new Date(a.timeStartRace) : new Date(0);
              const timeB = b.timeStartRace ? new Date(b.timeStartRace) : new Date(0);
              return timeA.getTime() - timeB.getTime();
            });

          const categoryMap: Record<string, CategoryProps> = {};
          const riderUpdates: RiderProps[] = [];

          riders.forEach((rider) => {
            if (!rider.category) return; // Ensure rider has a category

            // Create unique key for category + subCategory combination
            const categoryKey = rider.subCategory
              ? `${rider.category}::${rider.subCategory}`
              : rider.category;

            if (!categoryMap[categoryKey]) {
              const colorIndex = Object.keys(categoryMap).length % COLORS.length;
              categoryMap[categoryKey] = {
                id: Date.now() + Object.keys(categoryMap).length,
                raceUuid,
                name: rider.category,
                subCategory: rider.subCategory || null,
                laps: rider.totalLaps || 0,
                lapsCounter: 0,
                riders: 0, // ✅ Always initialize to 0
                startTime: normTime(rider.timeStartRace),
                isConnected: false,
                // Provisional — replaced below once every start time is known
                color: COLORS[colorIndex].code,
                heat: rider.heat || null,
                importOrder: fileOrder.get(categoryKey),
                status: "upcoming",
              };
            }
            categoryMap[categoryKey].riders = (categoryMap[categoryKey]?.riders ?? 0) + 1;
          });

          // Colours are assigned only once ALL categories and their start times
          // are known — waves that can be on course together must look distinct,
          // which can't be decided while still discovering them (BUGS.md #6).
          // Skipped when the organizer turned Auto color off for this race.
          const race = (await db.getAll("races")).find(
            (r: RaceProps) => r.uuid === raceUuid
          );
          if (race?.autoColor !== false) {
            const palette = assignCategoryColors(Object.values(categoryMap));
            for (const cat of Object.values(categoryMap)) {
              const assigned = palette.get(`${cat.name}::${cat.subCategory ?? ""}`);
              if (assigned) cat.color = assigned;
            }
          }

          // ✅ Ensure riders get the correct color (after final assignment)
          riders.forEach((rider) => {
            if (!rider.category) return;
            const categoryKey = rider.subCategory
              ? `${rider.category}::${rider.subCategory}`
              : rider.category;
            const cat = categoryMap[categoryKey];
            if (cat) riderUpdates.push({ ...rider, color: cat.color });
          });

          // ✅ Store updated categories in Zustand and IndexedDB
          const newCategories = Object.values(categoryMap);
          set((state) => ({ categories: [...state.categories, ...newCategories] }));

          const tx = db.transaction("categories", "readwrite");
          const store = tx.objectStore("categories");

          for (const category of newCategories) {
            await store.put(category);
          }
          await tx.done;

          // ✅ Update all riders with the correct category color
          await useRiderStore.getState().updateAllRiders(riderUpdates);

          db.close();

        } catch (error) {
          console.error("Error creating categories from riders:", error);
        }
      },


      rebuildCategoriesFromRiders: async (raceUuid) => {
        if (blockIfFinalized([{ raceUuid }], "rebuild")) return;
        try {
          // Clear existing categories for this race from IDB
          const db = await initIndexedDB();
          const allCats: CategoryProps[] = await db.getAll("categories");
          const toDelete = allCats.filter((c) => c.raceUuid === raceUuid);
          if (toDelete.length > 0) {
            const tx = db.transaction("categories", "readwrite");
            const store = tx.objectStore("categories");
            for (const cat of toDelete) await store.delete(cat.id);
            await tx.done;
          }
          db.close();

          // Clear from Zustand
          set((state) => ({
            categories: state.categories.filter((c) => c.raceUuid !== raceUuid),
          }));

          // Rebuild from current riders
          await get().createCategoriesFromRiders(raceUuid);
        } catch (error) {
          console.error("Error rebuilding categories:", error);
        }
      },

      updateRiderColor: async (categoryName, color, raceUuid) => {
        if (blockIfFinalized([{ raceUuid }], "recolour")) return;
        try {
          const db = await initIndexedDB();
          const tx = db.transaction("riders", "readwrite");
          const store = tx.objectStore("riders");
          const allRiders: RiderProps[] = await store.getAll();

          const updatedRiders = allRiders.map((rider) => {
            if (rider.category === categoryName && rider.raceUuid === raceUuid) {
              return { ...rider, color };
            }
            return rider;
          });

          for (const rider of updatedRiders) {
            await store.put(rider);
          }

          await tx.done;
          db.close();

          useRiderStore.setState({ riders: updatedRiders });

        } catch (error) {
          console.error("Error updating rider color:", error);
        }
      },

      /**
       * Write a batch of categories in ONE store set and ONE IDB transaction.
       *
       * Use this whenever a whole set of categories arrives at once (race
       * download / import). Looping `updateCategory` instead opens a separate
       * DB connection per category and, because it is async, callers that
       * forget to await it navigate away while the writes are still in flight —
       * the race screen then reads a half-written category list and shows no
       * rider cards until the writes catch up.
       */
      upsertCategories: async (cats: CategoryProps[]) => {
        if (cats.length === 0) return;
        if (blockIfFinalized(cats, "upsert")) return;
        set((state) => {
          const byId = new Map(state.categories.map((c) => [c.id, c]));
          for (const cat of cats) byId.set(cat.id, cat);
          return { categories: [...byId.values()] };
        });

        try {
          const db = await initIndexedDB();
          const tx = db.transaction("categories", "readwrite");
          const store = tx.objectStore("categories");
          await Promise.all(cats.map((cat) => store.put(cat)));
          await tx.done;
          db.close();
        } catch (error) {
          console.error("Error upserting categories in IDB:", error);
        }
      },

      updateCategory: async (updatedCategory: CategoryProps) => {
        if (blockIfFinalized([updatedCategory], "update")) return;
        try {
          const { categories } = get();

          // Check if category exists
          const existingIndex = categories.findIndex((c) => c.id === updatedCategory.id);

          let updatedCategories;
          if (existingIndex >= 0) {
            // Update existing category
            updatedCategories = categories.map((c) =>
              c.id === updatedCategory.id ? updatedCategory : c
            );
          } else {
            // Add new category
            updatedCategories = [...categories, updatedCategory];
          }

          set({ categories: updatedCategories });

          const db = await initIndexedDB();
          const tx = db.transaction("categories", "readwrite");
          const store = tx.objectStore("categories");
          await store.put(updatedCategory);
          await tx.done;
          db.close();
        } catch (error) {
          console.error("Error updating category in IDB:", error);
        }
      }
    }),
    {
      name: "category-storage",
      storage: categoryStorageAdapter(),
      partialize: (state) => ({ categories: state.categories }),
    }
  )
);

export default useCategoryStore;
