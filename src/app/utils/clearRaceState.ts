import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";


export const clearRaceState = () => {
   useRiderStore.setState({ riders: [] }); // Clear riders from Zustand
   useCategoryStore.setState({ categories: [] }); // Clear categories from Zustand
};
