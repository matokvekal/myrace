import React, { useState } from "react";
import styles from "./transferModal.module.css";
import type { CategoryProps, RiderProps } from "@/types/types";
import { riderInCategory, catWaveKey } from "../schedule/Schedule";

interface Props {
  categories: CategoryProps[];
  riders: RiderProps[];
  onConfirm: (selected: CategoryProps[]) => void;
  onCancel: () => void;
}

// Lets a commissaire export only the categories they were responsible for, so
// the main commissaire can merge the file back without touching other categories.
const ExportCategoriesModal: React.FC<Props> = ({ categories, riders, onConfirm, onCancel }) => {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(categories.map((c) => catWaveKey(c.name, c.subCategory)))
  );

  const toggle = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allSelected = selectedKeys.size === categories.length;
  const selectedCats = categories.filter((c) => selectedKeys.has(catWaveKey(c.name, c.subCategory)));
  const selectedRiderCount = riders.filter((r) => selectedCats.some((c) => riderInCategory(r, c))).length;

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.title}>Export to Excel</h3>
        <p className={styles.subtitle}>
          Choose which categories to include. Export only your own categories to send
          results to the main commissaire, or all of them for a full backup.
        </p>

        <div className={styles.selectAllRow}>
          <button
            className={styles.selectAllBtn}
            onClick={() =>
              setSelectedKeys(
                allSelected
                  ? new Set()
                  : new Set(categories.map((c) => catWaveKey(c.name, c.subCategory)))
              )
            }
          >
            {allSelected ? "Clear all" : "Select all"}
          </button>
          <span className={styles.countLabel}>
            {selectedCats.length}/{categories.length} categories · {selectedRiderCount} riders
          </span>
        </div>

        <div className={styles.catList}>
          {categories.length === 0 && (
            <div className={styles.emptyNote}>No categories in this race yet.</div>
          )}
          {categories.map((c) => {
            const key = catWaveKey(c.name, c.subCategory);
            const checked = selectedKeys.has(key);
            const riderCount = riders.filter((r) => riderInCategory(r, c)).length;
            return (
              <label
                key={key}
                className={`${styles.catRow} ${checked ? styles.catRowChecked : ""}`}
              >
                <input
                  type="checkbox"
                  className={styles.catCheckbox}
                  checked={checked}
                  onChange={() => toggle(key)}
                />
                <div className={styles.catInfo}>
                  <div className={styles.catName} dir="auto">
                    {c.name}
                    {c.subCategory && <span className={styles.catSub}> · {c.subCategory}</span>}
                  </div>
                  <div className={styles.catMeta}>
                    <span>{riderCount} riders</span>
                    <span
                      className={`${styles.statusChip} ${
                        c.status === "finished" ? styles.statusFinished : ""
                      }`}
                    >
                      {c.status ?? "upcoming"}
                    </span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
          <button
            className={styles.confirmBtn}
            disabled={selectedCats.length === 0}
            onClick={() => onConfirm(selectedCats)}
          >
            Export {allSelected ? "All" : `${selectedCats.length} ${selectedCats.length === 1 ? "Category" : "Categories"}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportCategoriesModal;
