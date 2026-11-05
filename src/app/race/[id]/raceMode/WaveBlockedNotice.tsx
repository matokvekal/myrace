import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Timer } from "lucide-react";
import styles from "./waveBlockedNotice.module.css";

/**
 * Starting a wave while an earlier one is still on course: say which wave is
 * running and what to do — never a silent no-op. Friendly, not an error.
 * The rule itself is unchanged (StartManager + server engine "one wave at a time").
 */
interface Props {
  activeWave: number;
  wave: number;
  onBack: () => void;
  onGoToActive: () => void;
}

export default function WaveBlockedNotice({ activeWave, wave, onBack, onGoToActive }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return createPortal(
    <div className={styles.overlay} onClick={onBack}>
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wave-blocked-title"
        data-testid="wave-blocked-notice"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.badge} aria-hidden="true"><Timer size={22} /></div>
        <h3 id="wave-blocked-title" className={styles.title}>Wave {activeWave} is still in progress</h3>
        <p className={styles.text} data-testid="wave-blocked-text">
          Wave {activeWave} is still in progress. Please finish it before starting Wave {wave}.
        </p>
        <p className={styles.hint}>Only one wave races at a time, so laps and results stay with the right wave.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.back} onClick={onBack} data-testid="wave-blocked-back">Back to Race</button>
          <button type="button" className={styles.go} onClick={onGoToActive} data-testid="wave-blocked-go">
            Go to Active Wave {activeWave}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
