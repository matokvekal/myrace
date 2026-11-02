import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { CheckInChange, CheckInChangeKind } from "@/stores/checkInChangesStore";
import styles from "./checkInChanges.module.css";

const KIND_LABEL: Record<CheckInChangeKind, string> = { status: "Status", bib: "Bib", added: "Added" };

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** The main commissaire's report: what changed on this wave's start list. */
const CheckInChanges: React.FC<{ wave: number; changes: CheckInChange[]; onClose: () => void }> = ({ wave, changes, onClose }) =>
  createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-label={`Check-In changes, wave ${wave}`}
        data-testid="checkin-changes"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <span className={styles.headText}>
            <b>Check-In changes</b>
            <span>Wave {wave} · {changes.length} change{changes.length === 1 ? "" : "s"}</span>
          </span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className={styles.list}>
          {changes.map((c, i) => (
            <div key={`${c.timestamp}-${i}`} className={styles.row} data-testid="checkin-change">
              <span className={`${styles.kind} ${styles[`kind_${c.kind}`]}`}>{KIND_LABEL[c.kind]}</span>
              <span className={styles.main}>
                <span className={styles.who} dir="auto">{c.bib} · {c.riderName}</span>
                <span className={styles.text} dir="auto">{c.text}</span>
              </span>
              <span className={styles.when}>
                {clock(c.timestamp)}
                {c.by !== "UNKNOWN" && <span dir="auto">{c.by}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );

export default CheckInChanges;
