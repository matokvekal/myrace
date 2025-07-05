// src/stores/useCategoryStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { CategoryProps, RiderProps } from "@/types/types";
import categoryStorageAdapter from "./indexDb/categoryStorageAdapter";
import { COLORS } from "@/constants/index";
import useRiderStore from "./ridersStore";

interface CategoryState {
  categories: CategoryProps[];
  getCategories: (raceUuid: string) => Promise<CategoryProps[]>;
  createCategoriesFromRiders: (raceUuid: string) => Promise<void>;
  updateRiderColor: (categoryName: string, color: string, raceUuid: string) => Promise<void>;
  updateCategory: (updatedCategory: CategoryProps) => void;
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

      createCategoriesFromRiders: async (raceUuid) => {
        try {
          const db = await initIndexedDB();
          let riders: RiderProps[] = await db.getAll("riders");

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

            if (!categoryMap[rider.category]) {
              const colorIndex = Object.keys(categoryMap).length % COLORS.length;
              categoryMap[rider.category] = {
                  id: Date.now() + Object.keys(categoryMap).length,
                  raceUuid,
                  name: rider.category,
                  laps: rider.totalLaps || 0,
                  lapsCounter: 0,
                  riders: 0, // ✅ Always initialize to 0
                  startTime: rider.timeStartRace || null,
                  isConnected: false,
                  color: COLORS[colorIndex].code, // ✅ Assign color from COLORS array
                  heat: rider.heat || null,
                  status: "upcoming",
              };
          }
          categoryMap[rider.category].riders = (categoryMap[rider.category]?.riders ?? 0) + 1;

            // ✅ Ensure riders get the correct color
            riderUpdates.push({ ...rider, color: categoryMap[rider.category].color });

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


      updateRiderColor: async (categoryName, color, raceUuid) => {
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

      updateCategory: async (updatedCategory: CategoryProps) => {
        try {
          const { categories } = get();
          const updatedCategories = categories.map((c) =>
            c.id === updatedCategory.id ? updatedCategory : c
          );
      
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
