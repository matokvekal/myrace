import React, { useState } from "react";
import styles from "./jokerResolveModal.module.css";
import { RiderProps } from "@/types/types";
import type { JokerEntry } from "./useJokerQueue";

interface Props {
  joker: JokerEntry;
  /** Full riders list, used only for the live "who is this?" preview as the bib is typed. */
  riders: RiderProps[];
  /** Returns true on success (modal closes); false leaves the modal open to retry — the
   * caller has already shown a toast explaining why. */
  onSave: (bibNumber: number) => boolean;
  onDelete: () => void;
  onClose: () => void;
}

const OUT_STATUSES = new Set(["DNF", "DSQ", "DNS"]);

const JokerResolveModal: React.FC<Props> = ({ joker, riders, onSave, onDelete, onClose }) => {
  const [bib, setBib] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const capturedLabel = new Date(joker.capturedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const trimmed = bib.trim();
  const match = trimmed
    ? riders.find((r) => String(r.bibNumber) === trimmed)
    : undefined;

  const handleSave = () => {
    const n = Number(trimmed);
    if (!trimmed || !Number.isFinite(n)) return;
    const ok = onSave(n);
    if (ok) onClose();
  };

  const handleDeleteClick = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete();
    onClose();
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>Joker #{joker.sequence}</div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.capturedRow}>
          Captured at <span className={styles.capturedTime}>{capturedLabel}</span>
        </div>

        <div className={styles.inputWrap}>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={5}
            autoFocus
            className={styles.bibInput}
            placeholder="Bib #"
            value={bib}
            onChange={(e) => setBib(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          />
        </div>

        {trimmed && (
          <div className={styles.preview}>
            {match ? (
              <>
                <span className={styles.previewName}>
                  {match.firstName} {match.lastName}
                </span>
                <span className={styles.previewCat}>
                  {match.category}
                  {OUT_STATUSES.has(match.status) && (
                    <span className={styles.previewWarn}> · {match.status}</span>
                  )}
                </span>
              </>
            ) : (
              <span className={styles.previewMiss}>No rider with this bib</span>
            )}
          </div>
        )}

        <div className={styles.actions}>
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={!trimmed}
          >
            Save
          </button>
          <button
            className={`${styles.deleteBtn} ${confirmDelete ? styles.deleteConfirm : ""}`}
            onClick={handleDeleteClick}
          >
            {confirmDelete ? "Tap again to delete" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default JokerResolveModal;
