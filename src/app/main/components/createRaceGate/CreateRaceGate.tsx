import React from "react";
import { createPortal } from "react-dom";
import { CloudDownload, RefreshCw } from "lucide-react";
import styles from "./createRaceGate.module.css";

/** Before Create Race (signed in): this account's races are synced first — progress, or the error with Retry. */
export type GateState = null | { kind: "syncing" } | { kind: "error"; message: string };

export default function CreateRaceGate({ state, onRetry, onCancel }: { state: GateState; onRetry: () => void; onCancel: () => void }) {
  if (!state) return null;
  return createPortal(
    <div className={styles.overlay}>
      <div className={styles.card} role={state.kind === "error" ? "alertdialog" : "status"} aria-live="polite" data-testid="create-race-gate" data-state={state.kind}>
        {state.kind === "syncing" ? (
          <>
            <div className={styles.icon} aria-hidden="true"><CloudDownload size={24} /></div>
            <h3 className={styles.title}>Syncing your races…</h3>
            <p className={styles.text}>Bringing your races from the cloud first, so nothing is duplicated or overwritten. Create Race opens next.</p>
            <div className={styles.bar} aria-hidden="true"><span /></div>
          </>
        ) : (
          <>
            <div className={`${styles.icon} ${styles.iconError}`} aria-hidden="true"><RefreshCw size={22} /></div>
            <h3 className={styles.title}>Couldn't sync your races</h3>
            <p className={styles.text} data-testid="create-race-gate-error" dir="auto">{state.message}</p>
            <p className={styles.hint}>No race was created. Check the connection and try again.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={onCancel}>Cancel</button>
              <button type="button" className={styles.primary} onClick={onRetry} data-testid="create-race-gate-retry">Retry</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
