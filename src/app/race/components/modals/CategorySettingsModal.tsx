
import React, { useState } from "react";
import styles from "./categorySettingsModal.module.css";
import useUIStore from "@/stores/uiStore";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import { CategoryProps } from "@/types/types";
import { COLORS } from "@/constants/index";

interface CategorySettingsModalProps {
  category: CategoryProps;
}

const CategorySettingsModal: React.FC<CategorySettingsModalProps> = ({
  category
}) => {
  const { closeModal } = useUIStore();
  const { updateCategory } = useCategoryStore();
  const { updateAllRiders, riders } = useRiderStore();

  const [startTime, setStartTime] = useState(category.startTime || "");
  const [color, setColor] = useState(category.color || "#000000");
  const [laps, setLaps] = useState(category.laps || 0);

  const handleSave = async () => {
    const updatedCategory = { ...category, startTime, color, laps };
    await updateCategory(updatedCategory);

    // Laps must follow onto the riders, or riders imported without a laps
    // column stay at 0 and the live screen reads 0/0 instead of 0/5
    // (BUGS.md #7). Matched on sub-category too so a legacy nested category
    // ("Man Masters 30-39") doesn't overwrite its siblings.
    const updatedRiders = riders.map((rider) =>
      rider.category === category.name &&
      (rider.subCategory ?? null) === (category.subCategory ?? null)
        ? { ...rider, color, totalLaps: laps || rider.totalLaps }
        : rider
    );
    await updateAllRiders(updatedRiders);
    closeModal("modalCategorySettings");
  };

  return (
    <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
      <div className={styles.modalHeader}>
        <div>Category Settings:{category.name}</div>
      </div>

      <div className={styles.modalBody}>
        <div className={styles.modalTime}>
          <label>Start Time:</label>
          <input className={styles.modalTimeInput}
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className={styles.laps}>
          <label>Laps:</label>
          <input className={styles.lapsInput}
            type="number"
            value={laps}
            onChange={(e) => setLaps(Number(e.target.value))}
          />
        </div>
        <label className={styles.colorLabel}>
          Color:
          <div
            className={styles.selectedColorPreview}
            style={{ backgroundColor: color }}
          />
        </label>
        <div className={styles.colorGrid}>
          {COLORS.map(({ name, code }) => (
            <div
              key={code}
              className={`${styles.colorSquare} ${
                color === code ? styles.selectedColor : ""
              }`}
              style={{ backgroundColor: code }}
              title={name}
              onClick={() => setColor(code)}
            />
          ))}
        </div>
 
      </div>

      <div className={styles.modalFooter}>
        <button
          className={styles.cancel}
          onClick={() => closeModal("modalCategorySettings")}
        >
          Cancel
        </button>
        <button className={styles.save} onClick={handleSave}>
          Save
        </button>
      </div>
    </div>
  );
};

export default CategorySettingsModal;
