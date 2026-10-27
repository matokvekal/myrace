import { useMemo, useState } from "react";
import type { RiderProps } from "@/types/types";
import type { JokerEntry } from "./useJokerQueue";
import { checkRecovery, hhmm, passagesOf, type RecoveryCheck } from "@/utils/passageRecovery";
import styles from "./recapPanel.module.css";

interface Props {
  /** Riders of the current wave. */
  riders: RiderProps[];
  /** Pending Unknown Rider passages (Joker). */
  jokers: JokerEntry[];
  minLapMs: number;
  /** Adds the confirmed recovered passage (estimated time). */
  onRecover: (rider: RiderProps, estimatedAt: Date) => void;
  onClose: () => void;
}

/** "HH:mm" today → Date (the race day). */
const todayAt = (hm: string): Date | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
};

/**
 * RECAP: the wave's passages in recording order (bib + HH:mm; full timestamps
 * kept), including pending "? Unknown Rider" passages, and recovery of a missed
 * passage at its estimated time — checked against the rider's existing
 * passages, never decided by elapsed time alone.
 */
export default function RecapPanel({ riders, jokers, minLapMs, onRecover, onClose }: Props) {
  const passages = useMemo(() => {
    const list: { key: string; at: number; label: string; recovered?: boolean; unknown?: boolean }[] = [];
    for (const r of riders) {
      for (const l of r.lapsDetails ?? []) {
        list.push({ key: `${r.id}-${l.lap}`, at: new Date(l.endTime).getTime(), label: `#${r.bibNumber}`, recovered: !!(l as { recovered?: boolean }).recovered });
      }
    }
    for (const j of jokers) list.push({ key: `j-${j.id}`, at: new Date(j.capturedAt).getTime(), label: "? Unknown Rider", unknown: true });
    return list.sort((a, b) => a.at - b.at).slice(-80);
  }, [riders, jokers]);

  const [bib, setBib] = useState("");
  const [time, setTime] = useState(() => hhmm(new Date()));
  const [check, setCheck] = useState<{ rider: RiderProps; at: Date; result: RecoveryCheck } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const review = () => {
    setError(null);
    setCheck(null);
    const rider = riders.find((r) => String(r.bibNumber) === bib.trim());
    if (!rider) return setError(`No rider with bib ${bib || "—"} in this wave`);
    const at = todayAt(time);
    if (!at) return setError("Enter the estimated passage time as HH:mm");
    setCheck({ rider, at, result: checkRecovery(rider, at, minLapMs) });
  };

  const add = () => {
    if (!check || check.result.kind === "invalid") return;
    onRecover(check.rider, check.at);
    setCheck(null);
    setBib("");
  };

  return (
    <aside className={styles.panel} aria-label="RECAP" data-testid="recap-panel">
      <div className={styles.head}>
        <strong>RECAP</strong>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close RECAP">✕</button>
      </div>

      <ol className={styles.list} data-testid="recap-list">
        {passages.length === 0 && <li className={styles.empty}>No passages yet</li>}
        {passages.map((p) => (
          <li key={p.key} className={p.unknown ? styles.unknown : undefined}>
            <span className={styles.bib}>{p.label}</span>
            <time dateTime={new Date(p.at).toISOString()}>{hhmm(p.at)}</time>
            {p.recovered && <span className={styles.recovered} title="Recovered missed passage">recovered</span>}
          </li>
        ))}
      </ol>

      <div className={styles.recover}>
        <div className={styles.recoverTitle}>Recover a missed passage</div>
        <div className={styles.row}>
          <input aria-label="Bib" inputMode="numeric" placeholder="Bib" value={bib} onChange={(e) => setBib(e.target.value)} data-testid="recap-bib" />
          <input aria-label="Estimated passage time" type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="recap-time" />
          <button type="button" onClick={review} data-testid="recap-check">Check</button>
        </div>
        {error && <div className={styles.warn} role="alert">{error}</div>}
        {check && (
          <div className={styles.review} data-testid="recap-review">
            <div>
              Bib {check.rider.bibNumber} — recorded passages:{" "}
              {passagesOf(check.rider).map((p) => hhmm(p)).join(", ") || "none"}
            </div>
            {check.result.kind === "invalid" && <div className={styles.warn} role="alert">Not added: {check.result.reason}.</div>}
            {check.result.kind === "near" && (
              <>
                <div className={styles.warn} role="alert">
                  A passage at {hhmm(check.result.nearest)} is already recorded within the minimum lap time — it may be this same
                  crossing. Add a separate passage at {hhmm(check.at)} only if the rider really crossed twice.
                </div>
                <button type="button" className={styles.danger} onClick={add} data-testid="recap-add-anyway">
                  Add anyway (becomes lap {check.result.becomesLap})
                </button>
              </>
            )}
            {check.result.kind === "ok" && (
              <button type="button" className={styles.primary} onClick={add} data-testid="recap-add">
                Add recovered passage at {hhmm(check.at)} (becomes lap {check.result.becomesLap})
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
