
import React from "react";
import styles from "./categoryModal.module.css"; // Create this CSS file for modal styling
import useUIStore from "@/stores/uiStore";

interface CategoryModalProps {
  categories: string[];
  selectCategory: (category: string) => void;
}

const CategoryModal: React.FC<CategoryModalProps> = ({
  categories,
  selectCategory
}) => {
  const { modals, closeModal, filters, openFilters, closeFilters } =
    useUIStore();

  if (!modals.showModalCategory) return null;

  const handleSelectCategory = (category: string) => {
    selectCategory(category);
    if (category === "All") {
      closeFilters("filterStandingCategory");
    } else {
      openFilters("filterStandingCategory");
    }
  };
  return (
    <div className={styles.modal}>
      <div
        className={styles.modalheader}
        onClick={() => closeModal("showModalCategory")}
      >
        Categories
      </div>
      <div className={styles.modalbottom}>
        {categories.length > 0 ? (
          categories.map((categoryName) => (
            <div
              key={categoryName}
              className={styles.line}
              // onClick={() => selectCategory(categoryName)}
              onClick={() => handleSelectCategory(categoryName)}
            >
              {categoryName}
            </div>
          ))
        ) : (
          <p className={styles.error}>No categories Found</p>
        )}
      </div>
    </div>
  );
};

export default CategoryModal;
