import React from "react";
import { createPortal } from "react-dom";
import { Pencil, X } from "lucide-react";
import styles from "./statusModal.module.css";
import useUIStore from "@/stores/uiStore";

type RiderStatus = "finished" | "running" | "standing" | "DNF" | "DSQ" | "DNS";

interface StatusModalProps {
  rider: any;
  onStatusChange: (status: RiderStatus) => void;
  /** The statuses this screen offers. Default: all of them. */
  statuses?: RiderStatus[];
  /** Adds a Change bib button. */
  onEditBib?: () => void;
}

// Out-statuses first — DNF, then DSQ, then DNS. These are what a commissaire
// actually reaches for mid-race; "finished"/"running"/"standing" are internal
// states set by the race flow itself and are rarely chosen by hand (BUGS.md #9).
const ALL_STATUSES: RiderStatus[] = ["DNF", "DSQ", "DNS", "standing", "running", "finished"];

const LABEL: Record<RiderStatus, { label: string; hint: string; tone: string }> = {
  DNF: { label: "DNF", hint: "Did not finish", tone: "toneOut" },
  DSQ: { label: "DSQ", hint: "Disqualified", tone: "toneOut" },
  DNS: { label: "DNS", hint: "Did not start", tone: "toneOut" },
  standing: { label: "Standing", hint: "No status, on the start list", tone: "toneOk" },
  running: { label: "Running", hint: "On course", tone: "toneOk" },
  finished: { label: "Finished", hint: "Crossed the line", tone: "toneOk" },
};

const StatusModal: React.FC<StatusModalProps> = ({ rider, onStatusChange, statuses = ALL_STATUSES, onEditBib }) => {
  const { modals, closeModal } = useUIStore();

  if (!modals.modalStatus) return null;

  const close = () => closeModal("modalStatus");

  // On <body>: the Check-In sheet's transform would otherwise trap this inside it.
  return createPortal(
    <div className={styles.overlay} onClick={close}>
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Rider status"
        data-testid="status-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalheader}>
          <span className={styles.bib}>{rider?.bibNumber}</span>
          <span className={styles.who}>
            <span className={styles.name} dir="auto">{rider?.lastName} {rider?.firstName}</span>
            <span className={styles.title}>Set status</span>
          </span>
          <button type="button" className={styles.close} onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className={styles.modalbottom}>
          {/* "Standing" is a way back from another status: a standing rider isn't offered it. */}
          {statuses.filter((s) => !(s === "standing" && (rider?.status ?? "standing") === "standing")).map((status) => {
            const { label, hint, tone } = LABEL[status];
            const current = rider?.status === status;
            return (
              <button
                type="button"
                key={status}
                className={`${styles.line} ${styles[tone]} ${current ? styles.current : ""}`}
                aria-pressed={current}
                onClick={() => {
                  onStatusChange(status);
                  close();
                }}
              >
                <span className={styles.label}>{label}</span>
                <span className={styles.hint}>{hint}</span>
              </button>
            );
          })}
        </div>

        {onEditBib && (
          <button
            type="button"
            className={styles.editBib}
            onClick={() => {
              onEditBib();
              close();
            }}
          >
            <Pencil size={15} /> Change bib number
          </button>
        )}
      </div>
    </div>,
    document.body
  );
};

export default StatusModal;
