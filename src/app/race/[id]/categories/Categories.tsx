"use client";

import React, { useState, useEffect } from "react";
import styles from "./categories.module.css";
import useCategoryStore from "@/stores/categoryStore";
import { CategoryProps } from "@/types/types";
import CategoryCard from "../../components/categoryCard/CategoryCard";
import CategorySettingsModal from "../../components/modals/CategorySettingsModal"; // ✅ Import the modal
import useUIStore from "@/stores/uiStore";

interface CategoriesProps {
  raceUuid: string;
}

const Categories: React.FC<CategoriesProps> = ({ raceUuid }) => {
  const { categories, getCategories } = useCategoryStore(); // ✅ Use Zustand's state
  const { modals } = useUIStore();
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] =
    useState<CategoryProps | null>(null);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        await getCategories(raceUuid); // ✅ Zustand updates state
        setLoading(false);
      } catch (error) {
        console.error("Error fetching categories:", error);
        setLoading(false);
      }
    };

    fetchCategories();
  }, [raceUuid, getCategories]);

  if (loading) {
    return <div>Loading categories...</div>;
  }

  return (
    <>
      <div className={styles.categoriesContainer}>
        {categories.length > 0 && (
          <div className={styles.tabCount}>Categories({categories.length})</div>
        )}
        {categories.length > 0 ? (
          categories.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              raceId={raceUuid}
              onStart={() => console.log(`Starting category ${category.id}`)}
              setSelectedCategory={setSelectedCategory}
            />
          ))
        ) : (
          <div>No categories found.</div>
        )}

        {selectedCategory && modals.modalCategorySettings && (
          <>
            <div className={styles.modalCategories}>
              <CategorySettingsModal category={selectedCategory} />
            </div>
            <div className={styles.modalLayout}></div>
          </>
        )}
      </div>
    </>
  );
};

export default Categories;
