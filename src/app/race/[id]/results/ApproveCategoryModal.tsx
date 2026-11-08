/**
 * 0.3.5 — "Approve official results" for one category. The judge must type APPROVED
 * exactly; the server checks the word again, the permission and that the category finished.
 */
import React, { useState } from "react";
import { createPortal } from "react-dom";
import { BadgeCheck, X } from "lucide-react";
import styles from "./approveCategoryModal.module.css";

export const APPROVE_WORD = "APPROVED";

export default function ApproveCategoryModal({
  raceUuid,
  categoryUuid,
  categoryName,
  onClose,
  onApproved,
}: {
  raceUuid: string;
  categoryUuid: string;
  categoryName: string;
  onClose: () => void;
  onApproved: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed === APPROVE_WORD;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { team } = await import("@/services/live/liveClient");
      await team.approveCategory(raceUuid, categoryUuid, typed);
      onApproved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <form className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="approve-title" onClick={(e) => e.stopPropagation()} onSubmit={submit} data-testid="approve-modal">
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close"><X size={18} /></button>
        <h3 id="approve-title" className={styles.title} dir="auto">
          <BadgeCheck size={20} aria-hidden="true" /> Approve {categoryName}
        </h3>
        <p className={styles.text} dir="auto">
          This makes the podium of <b>{categoryName}</b> official on the public results page, with your name and the time recorded.
          Any later change to this category's results withdraws the approval automatically.
        </p>
        <label className={styles.label} htmlFor="approve-word">Type <b>{APPROVE_WORD}</b> to confirm</label>
        <input
          id="approve-word"
          className={styles.input}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
          data-testid="approve-input"
        />
        {error && <p className={styles.error} role="alert" dir="auto">{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.confirm} disabled={!ready || busy} data-testid="approve-confirm">
            {busy ? "Approving…" : "Approve"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
