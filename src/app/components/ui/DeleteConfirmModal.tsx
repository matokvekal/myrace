"use client";

import { useState } from "react";
import styles from "./deleteConfirmModal.module.css";

interface DeleteConfirmModalProps {
  title: string;
  description: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
  /** Ask the user to type the confirm word (bulk deletes). Off: a plain confirm button, for one item. */
  requireTyping?: boolean;
  /** The word to type (default DELETE), and the button labels. */
  confirmWord?: string;
  confirmLabel?: string;
  busyLabel?: string;
}

export default function DeleteConfirmModal({
  title,
  description,
  onConfirm,
  onCancel,
  requireTyping = true,
  confirmWord = "DELETE",
  confirmLabel = "Confirm Delete",
  busyLabel = "Deleting…"
}: DeleteConfirmModalProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const isValid = !requireTyping || input.trim().toUpperCase() === confirmWord;

  const handleConfirm = async () => {
    if (!isValid || loading) return;
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className={styles.icon}>⚠️</div>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.description}>{description}</p>

        {requireTyping && (
        <div className={styles.confirmGroup}>
          <label className={styles.label}>
            Type <strong>{confirmWord}</strong> to confirm
          </label>
          <input
            className={styles.input}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
            placeholder={confirmWord}
            autoFocus
          />
        </div>
        )}

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            className={styles.confirmBtn}
            onClick={handleConfirm}
            disabled={!isValid || loading}
          >
            {loading ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
