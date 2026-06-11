
import React from "react";
import styles from "./statusModal.module.css";
import useUIStore from "@/stores/uiStore";

interface StatusModalProps {
  rider: any;
  onStatusChange: (
    status: "finished" | "running" | "standing" | "DNF" | "DSQ" | "DNS"
  ) => void;
}

const StatusModal: React.FC<StatusModalProps> = ({ rider, onStatusChange }) => {
  const { modals, closeModal } = useUIStore();

  if (!modals.modalStatus) return null;

  const statuses = ["finished", "running", "standing", "DNF", "DSQ", "DNS"];

  return (
    <div className={styles.modal}>
      <div
        className={styles.modalheader}
        onClick={() => closeModal("modalStatus")}
      >
        Status X
      </div>

      <div className={styles.modalbottom}>
        {statuses.map((status) => (
          <div
            key={status}
            className={styles.line}
            onClick={() => {
              onStatusChange(status as any);
              closeModal("modalStatus");
            }}
          >
            {status.toUpperCase()}
          </div>
        ))}
      </div>
    </div>
  );
};

export default StatusModal;
