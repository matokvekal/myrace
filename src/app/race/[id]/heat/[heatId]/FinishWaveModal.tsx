import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./finishWaveModal.module.css";

/**
 * "Finish This Wave?" — the end of a wave, presented like a finish line, not an
 * alarm. Same safeguard as before: type FINISH, then Confirm Finish. The finish
 * itself is the caller's (planWaveFinish via finishWaveFromLive); this only asks,
 * then shows a short celebration once the caller reports the wave was finished.
 */
export interface FinishWaveSummary {
  total: number;
  finished: number;
  onCourse: number;
  dnf: number;
  dsq: number;
  dns: number;
}

interface Props {
  wave: number;
  raceName?: string;
  startTime?: string | null;
  categories: string[];
  summary: FinishWaveSummary;
  /** Resolves true when the wave was finished (false: nothing done, e.g. not allowed). */
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
}

const CONFIRM_WORD = "FINISH";
const CELEBRATE_MS = 1800;

/** Small chequered flag (subtle, monochrome). */
function FinishFlag({ size = 40 }: { size?: number }) {
  const cells = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) if ((r + c) % 2 === 0) cells.push(<rect key={`${r}-${c}`} x={10 + c * 5} y={6 + r * 5} width={5} height={5} />);
  return (
    <svg className={styles.flag} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="7" y="4" width="2.2" height="33" rx="1.1" className={styles.flagPole} />
      <rect x="10" y="6" width="25" height="20" className={styles.flagCloth} />
      <g className={styles.flagChecks}>{cells}</g>
    </svg>
  );
}

export default function FinishWaveModal({ wave, raceName, startTime, categories, summary, onConfirm, onClose }: Props) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const valid = typed.trim().toUpperCase() === CONFIRM_WORD;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && !done) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, done, onClose]);

  // Live re-renders every second (its clock), giving a new onClose each time: keep the
  // latest in a ref so the celebration's timer isn't restarted forever.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => onCloseRef.current(), CELEBRATE_MS);
    return () => window.clearTimeout(t);
  }, [done]);

  const confirm = async () => {
    if (!valid || busy || done) return;
    setBusy(true);
    try {
      if (await onConfirm()) setDone(true);
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  const out = summary.dnf + summary.dsq + summary.dns;

  return createPortal(
    <div className={styles.overlay} onClick={() => !busy && onClose()} data-testid="finish-wave-modal">
      <div
        className={`${styles.modal} ${done ? styles.modalDone : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="finish-wave-title"
        onClick={(e) => { if (!done) e.stopPropagation(); }}
      >
        <div className={styles.finishLine} aria-hidden="true" />

        {done ? (
          <div className={styles.celebrate} role="status" data-testid="finish-wave-done">
            <div className={styles.celebrateFlag}><FinishFlag size={64} /></div>
            <h3 className={styles.title}>Wave {wave} finished</h3>
            <p className={styles.sub}>
              {summary.total} rider{summary.total === 1 ? "" : "s"} · results are in the Results tab
            </p>
            <p className={styles.tapHint}>Tap anywhere to continue</p>
          </div>
        ) : (
          <>
            <div className={styles.head}>
              <FinishFlag />
              <div>
                <h3 id="finish-wave-title" className={styles.title}>Finish This Wave?</h3>
                <p className={styles.sub} dir="auto">
                  Wave {wave}{startTime ? ` · ${startTime}` : ""}{raceName ? ` · ${raceName}` : ""}
                </p>
              </div>
            </div>

            {categories.length > 0 && (
              <p className={styles.cats} dir="auto">{categories.join(" · ")}</p>
            )}

            <div className={styles.stats}>
              <div className={styles.stat}>
                <span className={styles.statValue} data-testid="finish-wave-finished">{summary.finished}</span>
                <span className={styles.statLabel}>finished</span>
              </div>
              <div className={styles.stat}>
                <span className={`${styles.statValue} ${summary.onCourse > 0 ? styles.statOnCourse : ""}`} data-testid="finish-wave-oncourse">{summary.onCourse}</span>
                <span className={styles.statLabel}>on course</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statValue}>{out}</span>
                <span className={styles.statLabel}>
                  {out > 0 ? [summary.dnf && `${summary.dnf} DNF`, summary.dsq && `${summary.dsq} DSQ`, summary.dns && `${summary.dns} DNS`].filter(Boolean).join(" · ") : "DNF · DSQ · DNS"}
                </span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statValue}>{summary.total}</span>
                <span className={styles.statLabel}>riders</span>
              </div>
            </div>

            {summary.onCourse > 0 ? (
              <p className={styles.note} data-testid="finish-wave-note">
                {summary.onCourse} rider{summary.onCourse === 1 ? " is" : "s are"} still on course. They will be classified
                as finishers on the laps they have completed — no finish time is invented. Other waves are not affected.
              </p>
            ) : (
              <p className={styles.noteCalm}>Everyone is in. Recorded laps and times are kept; other waves are not affected.</p>
            )}

            <label className={styles.confirmLabel} htmlFor="finish-wave-input">
              Type <strong>{CONFIRM_WORD}</strong> to confirm
            </label>
            <input
              id="finish-wave-input"
              className={styles.input}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void confirm(); }}
              placeholder={CONFIRM_WORD}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
            />

            <div className={styles.actions}>
              <button type="button" className={styles.cancel} onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className={styles.confirm} onClick={() => void confirm()} disabled={!valid || busy}>
                <FinishFlag size={18} /> {busy ? "Finishing…" : "Confirm Finish"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
