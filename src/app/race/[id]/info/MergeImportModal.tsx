import React, { useState } from "react";
import styles from "./transferModal.module.css";
import type { CategoryProps, RiderProps } from "@/types/types";
import { riderInCategory, catWaveKey } from "../schedule/Schedule";

export type ImportMode = "merge" | "replace";

interface Props {
  fileRaceName: string;
  fileCategories: CategoryProps[];
  fileRiders: RiderProps[];
  localCategories: CategoryProps[];
  localRiders: RiderProps[];
  onConfirm: (selected: CategoryProps[], mode: ImportMode) => Promise<void>;
  onCancel: () => void;
}

function catHasResults(cat: CategoryProps, riders: RiderProps[]): boolean {
  if (cat.status === "finished") return true;
  return riders.some(
    (r) =>
      riderInCategory(r, cat) &&
      (r.lapsCounter > 0 || (r.raceStatus && r.raceStatus !== "upcoming"))
  );
}

// Shown after parsing an imported Excel file: lists the categories found in the
// file and lets the main commissaire pick which ones to merge in. Each selected
// category fully replaces the local results of that category — nothing else changes.
const MergeImportModal: React.FC<Props> = ({
  fileRaceName,
  fileCategories,
  fileRiders,
  localCategories,
  localRiders,
  onConfirm,
  onCancel,
}) => {
  // Pre-select the categories that actually carry results; if none do
  // (e.g. a pre-race start-list file), pre-select everything.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => {
    const withResults = fileCategories.filter((c) => catHasResults(c, fileRiders));
    const initial = withResults.length > 0 ? withResults : fileCategories;
    return new Set(initial.map((c) => catWaveKey(c.name, c.subCategory)));
  });
  const [mode, setMode] = useState<ImportMode>("merge");
  const [busy, setBusy] = useState(false);

  const toggle = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allSelected = selectedKeys.size === fileCategories.length;
  const selectedCats = fileCategories.filter((c) =>
    selectedKeys.has(catWaveKey(c.name, c.subCategory))
  );
  const effectiveCats = mode === "replace" ? fileCategories : selectedCats;
  const effectiveRiderCount =
    mode === "replace"
      ? fileRiders.length
      : fileRiders.filter((r) => selectedCats.some((c) => riderInCategory(r, c))).length;

  const handleConfirm = async () => {
    if (busy || (mode === "merge" && selectedCats.length === 0)) return;
    setBusy(true);
    try {
      await onConfirm(effectiveCats, mode);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={busy ? undefined : onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.title}>Import Results</h3>
        <p className={styles.subtitle} dir="auto">
          File: <strong>{fileRaceName}</strong> — {fileCategories.length} categories,{" "}
          {fileRiders.length} riders. Pick the categories to bring in; each one
          replaces the local results of that category only.
        </p>

        <div className={styles.selectAllRow}>
          <button
            className={styles.selectAllBtn}
            disabled={mode === "replace"}
            onClick={() =>
              setSelectedKeys(
                allSelected
                  ? new Set()
                  : new Set(fileCategories.map((c) => catWaveKey(c.name, c.subCategory)))
              )
            }
          >
            {allSelected ? "Clear all" : "Select all"}
          </button>
          <span className={styles.countLabel}>
            {effectiveCats.length}/{fileCategories.length} categories · {effectiveRiderCount} riders
          </span>
        </div>

        <div className={styles.catList}>
          {fileCategories.length === 0 && (
            <div className={styles.emptyNote}>No categories found in this file.</div>
          )}
          {fileCategories.map((c) => {
            const key = catWaveKey(c.name, c.subCategory);
            const checked = mode === "replace" || selectedKeys.has(key);
            const riderCount = fileRiders.filter((r) => riderInCategory(r, c)).length;
            const hasResults = catHasResults(c, fileRiders);
            const localCat = localCategories.find(
              (lc) => catWaveKey(lc.name, lc.subCategory) === key
            );
            const overwritesLocal = localCat ? catHasResults(localCat, localRiders) : false;
            return (
              <label
                key={key}
                className={`${styles.catRow} ${checked ? styles.catRowChecked : ""} ${
                  mode === "replace" ? styles.catRowDisabled : ""
                }`}
              >
                <input
                  type="checkbox"
                  className={styles.catCheckbox}
                  checked={checked}
                  disabled={mode === "replace"}
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
                      {hasResults ? (c.status === "finished" ? "finished" : "has results") : "no results"}
                    </span>
                  </div>
                </div>
                {checked && overwritesLocal && (
                  <span className={styles.overwriteWarn}>overwrites local results</span>
                )}
              </label>
            );
          })}
        </div>

        <div className={styles.modeGroup}>
          <label className={styles.modeOption}>
            <input
              type="radio"
              name="importMode"
              checked={mode === "merge"}
              onChange={() => setMode("merge")}
            />
            <span>
              Merge selected categories
              <span className={styles.modeHint}>
                Only the checked categories are replaced — all other categories keep their local results.
              </span>
            </span>
          </label>
          <label className={styles.modeOption}>
            <input
              type="radio"
              name="importMode"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
            />
            <span className={mode === "replace" ? styles.modeDanger : undefined}>
              Replace entire race
              <span className={styles.modeHint}>
                Deletes ALL local riders and categories of this race and loads the file instead.
              </span>
            </span>
          </label>
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={`${styles.confirmBtn} ${mode === "replace" ? styles.confirmBtnDanger : ""}`}
            disabled={busy || (mode === "merge" && selectedCats.length === 0)}
            onClick={handleConfirm}
          >
            {busy
              ? "Importing…"
              : mode === "replace"
              ? "Replace Entire Race"
              : `Merge ${selectedCats.length} ${selectedCats.length === 1 ? "Category" : "Categories"}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MergeImportModal;
