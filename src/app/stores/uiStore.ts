import { create } from "zustand";

export interface UIState {
  modals: {
    modalStatus: boolean;
    modalAddRider: boolean;
    showSplash: boolean;
    showModalCategory: boolean;
    showModalTeam: boolean;
    modalCategorySettings: boolean;
  };
  filters: {
    filterStandingCategory: boolean;
  };
  openFilters: (filter: any) => void;
  closeFilters: (filter: any) => void;

  modalData: any;
  openModal: (modalName: keyof UIState["modals"], data?: any) => void;
  closeModal: (modalName?: keyof UIState["modals"]) => void;
  closeAllModals: () => void;
}

const useUIStore = create<UIState>((set) => ({
  modals: {
    modalStatus: false,
    modalAddRider: false,
    showSplash: false,
    showModalCategory: false,
    showModalTeam: false,
    modalCategorySettings: false,
  },
  filters: {
    filterStandingCategory: false,
  },
  openFilters: (filter: keyof UIState["filters"]) =>
    set((state) => ({
      filters: { ...state.filters, [filter]: true },
    })),
  closeFilters: (filter: keyof UIState["filters"]) =>
    set((state) => ({
      filters: { ...state.filters, [filter]: false },
    })),

  modalData: null,

  openModal: (modalName: keyof UIState["modals"], data: any = null) =>
    set((state) => ({
      modals: { ...state.modals, [modalName]: true },
      modalData: data,
    })),

  closeModal: (modalName?: keyof UIState["modals"]) =>
    set((state) => {
      if (modalName) {
        return { modals: { ...state.modals, [modalName]: false }, modalData: null };
      }
      return state;
    }),

  closeAllModals: () =>
    set({
      modals: { modalStatus: false, modalAddRider: false, showSplash: false, showModalCategory: false, showModalTeam: false, modalCategorySettings: false },
      modalData: null,
    }),
}));

export default useUIStore;
