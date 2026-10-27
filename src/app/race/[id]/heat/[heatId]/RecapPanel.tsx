import { useEffect, useMemo, useState } from "react";
import type { RiderProps } from "@/types/types";
import type { JokerEntry } from "./useJokerQueue";
import { checkRecovery, hhmm, type RecoveryCheck } from "@/utils/passageRecovery";
import styles from "./recapPanel.module.css";

interface Props {
  /** Riders of the current wave. */
  riders: RiderProps[];
  /** Pending Unknown Rider passages (Joker). */
  jokers: JokerEntry[];
  minLapMs: number;
  /** Adds the confirmed recovered passage (estimated time). */
  onRecover: (rider: RiderProps, estimatedAt: Date) => void;
  /** The rider selected in RECAP MODE (tap, voice or exact bib). */
  selectedRider?: RiderProps | null;
  /** True while a correction is being prepared (RECAP MODE must not time out). */
  onBusyChange?: (busy: boolean) => void;
  /** Any interaction inside the panel (restarts the RECAP inactivity countdown). */
  onActivity?: () => void;
}

/** "HH:mm" today → Date (the race day). */
const todayAt = (hm: string): Date | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d;
};

type Lap = RiderProps["lapsDetails"][number] & { recovered?: boolean };

/**
 * RECAP MODE content: the selected rider's passages and the safe correction
 * (a missed passage at its estimated time — checked against the rider's
 * existing passages, never decided by elapsed time alone), plus the wave's
 * recent passages in recording order (bib + HH:mm; full timestamps kept),
 * including pending "? Unknown Rider" passages.
 */
export default function RecapPanel({ riders, jokers, minLapMs, onRecover, selectedRider, onBusyChange, onActivity }: Props) {
  const passages = useMemo(() => {
    const list: { key: string; at: number; label: string; recovered?: boolean; unknown?: boolean }[] = [];
    for (const r of riders) {
      for (const l of r.lapsDetails ?? []) {
        list.push({ key: `${r.id}-${l.lap}`, at: new Date(l.endTime).getTime(), label: `#${r.bibNumber}`, recovered: !!(l as Lap).recovered });
      }
    }
    for (const j of jokers) list.push({ key: `j-${j.id}`, at: new Date(j.capturedAt).getTime(), label: "? Unknown Rider", unknown: true });
    return list.sort((a, b) => a.at - b.at).slice(-80);
  }, [riders, jokers]);

  const [bib, setBib] = useState("");
  const [time, setTime] = useState(() => hhmm(new Date()));
  const [timeEdited, setTimeEdited] = useState(false);
  const [check, setCheck] = useState<{ rider: RiderProps; at: Date; result: RecoveryCheck } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A rider selected in RECAP MODE fills the form (nothing is recorded).
  useEffect(() => {
    if (!selectedRider) return;
    setBib(String(selectedRider.bibNumber));
    setCheck(null);
    setError(null);
    setTimeEdited(false);
    setTime(hhmm(new Date()));
  }, [selectedRider?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A correction in progress: a reviewed result waiting for a decision, or an edited time.
  const busy = check !== null || timeEdited;
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const current = riders.find((r) => String(r.bibNumber) === bib.trim()) ?? null;
  const currentLaps = ((current?.lapsDetails ?? []) as Lap[])
    .slice()
    .sort((a, b) => new Date(a.endTime).getTime() - new Date(b.endTime).getTime());

  const review = () => {
    setError(null);
    setCheck(null);
    if (!current) return setError(`No rider with bib ${bib || "—"} in this wave`);
    const at = todayAt(time);
    if (!at) return setError("Enter the estimated passage time as HH:mm");
    setCheck({ rider: current, at, result: checkRecovery(current, at, minLapMs) });
  };

  const add = () => {
    if (!check || check.result.kind === "invalid") return;
    onRecover(check.rider, check.at);
    setCheck(null);
    setTimeEdited(false);
  };

  const cancel = () => {
    setCheck(null);
    setTimeEdited(false);
    setError(null);
  };

  return (
    <section className={styles.panel} aria-label="RECAP" data-testid="recap-panel" onPointerDown={onActivity} onKeyDown={onActivity}>
      <div className={styles.rider} data-testid="recap-rider">
        {current ? (
          <>
            <div className={styles.riderHead} dir="auto">
              <strong>#{current.bibNumber}</strong> {current.firstName} {current.lastName}
              <span className={styles.muted}> · {current.lapsCounter} lap{current.lapsCounter === 1 ? "" : "s"}</span>
            </div>
            <ol className={styles.riderLaps} data-testid="recap-rider-passages">
              {currentLaps.length === 0 && <li className={styles.muted}>No passages recorded</li>}
              {currentLaps.map((l) => (
                <li key={l.lap}>
                  Lap {l.lap} · <time dateTime={new Date(l.endTime).toISOString()}>{hhmm(l.endTime)}</time>
                  {l.recovered && <span className={styles.recovered}>recovered</span>}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <div className={styles.muted}>Tap a rider, or type a bib, to see their passages and corrections. No lap is recorded in RECAP MODE.</div>
        )}
      </div>

      <div className={styles.recover}>
        <div className={styles.recoverTitle}>Recover a missed passage</div>
        <div className={styles.row}>
          <input
            aria-label="Bib"
            inputMode="numeric"
            placeholder="Bib"
            value={bib}
            onChange={(e) => { setBib(e.target.value); setCheck(null); }}
            data-testid="recap-bib"
          />
          <input
            aria-label="Estimated passage time"
            type="time"
            value={time}
            onChange={(e) => { setTime(e.target.value); setTimeEdited(true); setCheck(null); }}
            data-testid="recap-time"
          />
          <button type="button" onClick={review} data-testid="recap-check">Check</button>
        </div>
        {error && <div className={styles.warn} role="alert">{error}</div>}
        {check && (
          <div className={styles.review} data-testid="recap-review">
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
            <button type="button" className={styles.secondary} onClick={cancel} data-testid="recap-cancel">
              Cancel
            </button>
          </div>
        )}
      </div>

      <details className={styles.recent}>
        <summary>Recent passages ({passages.length})</summary>
        <ol className={styles.list} data-testid="recap-list">
          {passages.length === 0 && <li className={styles.muted}>No passages yet</li>}
          {passages.map((p) => (
            <li key={p.key} className={p.unknown ? styles.unknown : undefined}>
              <span className={styles.bib}>{p.label}</span>
              <time dateTime={new Date(p.at).toISOString()}>{hhmm(p.at)}</time>
              {p.recovered && <span className={styles.recovered} title="Recovered missed passage">recovered</span>}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
