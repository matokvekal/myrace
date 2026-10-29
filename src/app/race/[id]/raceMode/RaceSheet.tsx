import React, { useEffect, useRef } from "react";
import { ArrowLeft, CheckCircle2, ChevronRight, Circle, ClipboardCheck, Radio, X } from "lucide-react";
import type { CategoryProps, RiderProps } from "@/types/types";
import { riderInCategory } from "../schedule/Schedule";
import type { WaveState } from "./WaveTimeline";
import styles from "./raceSheet.module.css";

export type SheetSize = "half" | "full";
export type SheetView = "summary" | "checkin";

const OUT = ["DNS", "DNF", "DSQ"];
const STATE_LABEL: Record<WaveState, string> = { upcoming: "Upcoming", running: "Racing", finished: "Completed" };

interface Props {
  wave: number;
  state: WaveState;
  startLabel: string;
  categories: CategoryProps[];
  riders: RiderProps[];
  size: SheetSize;
  onSize: (s: SheetSize) => void;
  onClose: () => void;
  view: SheetView;
  onView: (v: SheetView) => void;
  /** The existing start screen (start groups, countdown, start / finish): shown as is. */
  renderStart: () => React.ReactNode;
  /** The existing Check-In screen, opened from the summary. */
  renderCheckIn: () => React.ReactNode;
}

/** Earliest actual start (HH:MM:SS) among riders of these categories, if any started. */
const actualStart = (cats: CategoryProps[], riders: RiderProps[]): string | null => {
  const t = riders
    .filter((r) => r.raceStatus !== "upcoming" && r.timeStartRace && cats.some((c) => riderInCategory(r, c)))
    .map((r) => r.timeStartRace as string)
    .sort();
  return t[0] ?? null;
};

/**
 * Race-day bottom sheet for one wave: a compact header, the Check-In summary,
 * and the existing start screen (StartManager) unchanged underneath. Half
 * height by default, full height for Check-In; drag handle, close, backdrop.
 */
const RaceSheet: React.FC<Props> = ({
  wave, state, startLabel, categories, riders, size, onSize, onClose, view, onView: setView, renderStart, renderCheckIn,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Drag handle: up = expand, down = shrink / close
  const dragY = useRef<number | null>(null);
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragY.current == null) return;
    const dy = e.clientY - dragY.current;
    dragY.current = null;
    if (dy < -40) onSize("full");
    else if (dy > 40) (size === "full" ? onSize("half") : onClose());
    else onSize(size === "full" ? "half" : "full");
  };

  const waveRiders = riders.filter((r) => categories.some((c) => riderInCategory(r, c)));
  const checked = waveRiders.filter((r) => r.checked).length;
  const accounted = waveRiders.filter((r) => r.checked || OUT.includes(r.status)).length;
  const notYet = waveRiders.length - accounted;
  const checkPct = waveRiders.length ? Math.round((accounted / waveRiders.length) * 100) : 0;
  const started = actualStart(categories, riders);

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} data-testid="sheet-backdrop" aria-hidden="true" />
      <section
        className={`${styles.sheet} ${size === "full" ? styles.full : styles.half}`}
        role="dialog"
        aria-label={`Wave ${wave}`}
        data-testid="wave-sheet"
      >
        <div
          className={styles.handleArea}
          onPointerDown={(e) => { dragY.current = e.clientY; }}
          onPointerUp={onPointerUp}
          role="button"
          tabIndex={0}
          aria-label={size === "full" ? "Shrink panel" : "Expand panel"}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onSize(size === "full" ? "half" : "full");
          }}
        >
          <span className={styles.handle} />
        </div>

        <header className={styles.head}>
          {view !== "summary" && (
            <button type="button" className={styles.iconBtn} onClick={() => setView("summary")} aria-label="Back to wave">
              <ArrowLeft size={18} />
            </button>
          )}
          <div className={styles.headMain}>
            <div className={styles.headTop}>
              <span className={styles.waveName}>Wave {wave}</span>
              <span className={styles.waveTime}>{startLabel}</span>
              <span className={`${styles.state} ${styles[`state_${state}`]}`}>
                {state === "running" ? <Radio size={13} /> : state === "finished" ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                {STATE_LABEL[state]}
              </span>
            </div>
            <div className={styles.headMeta}>
              {view === "checkin" && <b>Check-In</b>}
              <span>{categories.length} categor{categories.length === 1 ? "y" : "ies"}</span>
              <span>{waveRiders.length} riders</span>
              {started && <span>Started {started}</span>}
            </div>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close" title="Close">
            <X size={18} />
          </button>
        </header>

        <div className={styles.body}>
          {view === "summary" ? (
            <>
              <button
                type="button"
                className={styles.card}
                onClick={() => { setView("checkin"); onSize("full"); }}
                data-testid="sheet-checkin"
              >
                <span className={styles.cardIcon}><ClipboardCheck size={18} /></span>
                <span className={styles.cardMain}>
                  <span className={styles.cardTitle}>
                    Check-In <b>{checked} / {waveRiders.length}</b>
                    {notYet === 0 && waveRiders.length > 0 && <CheckCircle2 size={14} className={styles.okIcon} />}
                  </span>
                  <span className={styles.progress}><span style={{ width: `${checkPct}%` }} /></span>
                  <span className={styles.cardSub}>
                    {waveRiders.length === 0 ? "No riders in this wave" : notYet === 0 ? "Everyone accounted for" : `${notYet} not checked in yet`}
                  </span>
                </span>
                <ChevronRight size={18} className={styles.chev} />
              </button>

              {/* The proven start screen, unchanged: start groups, countdown, start / finish */}
              <div className={styles.startHost} data-testid="sheet-start">{renderStart()}</div>
            </>
          ) : (
            renderCheckIn()
          )}
        </div>
      </section>
    </>
  );
};

export default RaceSheet;
