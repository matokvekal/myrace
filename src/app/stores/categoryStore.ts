// src/stores/useCategoryStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { CategoryProps, RiderProps, RaceProps } from "@/types/types";
import categoryStorageAdapter from "./indexDb/categoryStorageAdapter";
import { buildCategoriesFromRiders, riderCategoryKey } from "@/utils/categoriesFromRiders";
import useRiderStore from "./ridersStore";
import { isRaceUuidFinalized } from "@/utils/raceLock";
import { isApplyingRemote, isLiveRace, liveBridge } from "@/services/live/liveBridge";

/**
 * Hard guard for a FINALIZED race — the category twin of the rider guard in
 * `ridersStore.ts`. See `utils/raceLock.ts` for why the lock is enforced down
 * here and not only in the UI.
 */
function blockIfFinalized(cats: { raceUuid: string }[], action: string): boolean {
  if (isApplyingRemote()) return false; // shared race: the server decides
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
  deleteCategory: (categoryId: number) => Promise<void>;
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
        // Never for a shared race (matrix row 47): its categories come from Actions.
        if (isLiveRace(raceUuid)) return;
        try {
          const db = await initIndexedDB();
          const riders: RiderProps[] = (await db.getAll("riders")).filter((r: RiderProps) => r.raceUuid === raceUuid);
          const race = (await db.getAll("races")).find((r: RaceProps) => r.uuid === raceUuid);
          const newCategories = buildCategoriesFromRiders(riders, raceUuid, race?.autoColor !== false);

          // Riders take their category colour (after the final assignment).
          const colorOf = new Map(newCategories.map((c) => [c.subCategory ? `${c.name}::${c.subCategory}` : c.name, c.color]));
          const riderUpdates = riders.filter((r) => r.category && colorOf.has(riderCategoryKey(r))).map((r) => ({ ...r, color: colorOf.get(riderCategoryKey(r))! }));

          // Store the categories in Zustand and IndexedDB
          set((state) => ({ categories: [...state.categories, ...newCategories] }));
          const tx = db.transaction("categories", "readwrite");
          const store = tx.objectStore("categories");
          for (const category of newCategories) {
            await store.put(category);
          }
          await tx.done;

          await useRiderStore.getState().updateAllRiders(riderUpdates);
          db.close();
        } catch (error) {
          console.error("Error creating categories from riders:", error);
        }
      },


      rebuildCategoriesFromRiders: async (raceUuid) => {
        if (blockIfFinalized([{ raceUuid }], "rebuild")) return;
        // Never rebuild a shared race's categories (matrix row 42): they come from Actions.
        if (isLiveRace(raceUuid)) return;
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
        {
          const byId = new Map(get().categories.map((c) => [c.id, c]));
          const before = cats.map((c) => byId.get(c.id)).filter((c): c is CategoryProps => !!c);
          if (liveBridge()?.beforeCategories("upsert", before, cats) === false) return;
        }
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

      deleteCategory: async (categoryId: number) => {
        const target = get().categories.find((c) => c.id === categoryId);
        if (!target) return;
        if (blockIfFinalized([target], "delete")) return;
        if (liveBridge()?.beforeCategories("delete", [target], []) === false) return;
        set((state) => ({ categories: state.categories.filter((c) => c.id !== categoryId) }));
        try {
          const db = await initIndexedDB();
          const tx = db.transaction("categories", "readwrite");
          await tx.objectStore("categories").delete(categoryId);
          await tx.done;
          db.close();
        } catch (error) {
          console.error("Error deleting category from IDB:", error);
        }
      },

      updateCategory: async (updatedCategory: CategoryProps) => {
        if (blockIfFinalized([updatedCategory], "update")) return;
        {
          const prev = get().categories.find((c) => c.id === updatedCategory.id);
          if (liveBridge()?.beforeCategories("upsert", prev ? [prev] : [], [updatedCategory]) === false) return;
        }
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
