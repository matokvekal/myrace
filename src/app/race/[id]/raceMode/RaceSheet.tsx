import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Flag,
  Radio,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { toast } from "react-toastify";
import type { CategoryProps, RiderProps } from "@/types/types";
import { riderInCategory, normalizeTime, toMinutes } from "../schedule/Schedule";
import { useWaveStart } from "./useWaveStart";
import type { WaveState } from "./WaveTimeline";
import styles from "./raceSheet.module.css";

export type SheetSize = "half" | "full";
type View = "summary" | "checkin" | "riders" | "advanced";

const OUT = ["DNS", "DNF", "DSQ"];
const STATE_LABEL: Record<WaveState, string> = { upcoming: "Upcoming", running: "Racing", finished: "Completed" };

interface Props {
  raceUuid: string;
  wave: number;
  state: WaveState;
  startLabel: string;
  categories: CategoryProps[];
  /** This wave's start groups: start time → categories (the schedule's slots). */
  slots: Map<string, CategoryProps[]>;
  riders: RiderProps[];
  size: SheetSize;
  onSize: (s: SheetSize) => void;
  onClose: () => void;
  /** The role may start waves (existing permission). */
  canStart?: boolean;
  /** Existing screens, shown inside the expanded sheet. */
  renderCheckIn: () => React.ReactNode;
  renderAllRiders: () => React.ReactNode;
  renderAdvanced: () => React.ReactNode;
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
 * Race-day bottom sheet for one wave (Google Maps style): half height for
 * quick operations (summary, Check-In progress, Start per start group with an
 * inline confirmation), full height for the detailed screens. Start uses the
 * shared useWaveStart (same rules as before); Check-In / All Riders / start
 * controls are the existing components.
 */
const RaceSheet: React.FC<Props> = ({
  raceUuid, wave, state, startLabel, categories, slots, riders, size, onSize, onClose, canStart = true,
  renderCheckIn, renderAllRiders, renderAdvanced,
}) => {
  const [view, setView] = useState<View>("summary");
  const [confirmSlot, setConfirmSlot] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [error, setError] = useState<{ slot: string; msg: string } | null>(null);
  const { otherWaveRunning, validateGroup, startGroup } = useWaveStart(raceUuid, wave, categories);

  // A different wave resets the working state (never the race data).
  useEffect(() => {
    setView("summary");
    setConfirmSlot(null);
    setError(null);
  }, [wave]);

  // Escape closes — never while a start is being submitted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busySlot) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busySlot, onClose]);

  const open = (v: View) => {
    setView(v);
    onSize("full");
  };

  // Drag handle: up = expand, down = shrink / close
  const dragY = useRef<number | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    dragY.current = e.clientY;
  };
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
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  const doStart = async (key: string, cats: CategoryProps[]) => {
    if (busySlot) return; // no double submission
    setError(null);
    setBusySlot(key);
    try {
      const ok = await startGroup(cats.map((c) => c.id));
      if (ok) {
        toast.success(`Wave ${wave} started${key !== "TBD" ? ` · start ${normalizeTime(key) ?? key}` : ""}`, { autoClose: 3000, toastId: "wave-start" });
        setConfirmSlot(null);
      } else {
        setError({ slot: key, msg: "Starting isn't allowed for your role in this shared race." });
      }
    } catch {
      setError({ slot: key, msg: "Couldn't start the wave. Check the connection and try again." });
    } finally {
      setBusySlot(null);
    }
  };

  const title = view === "checkin" ? "Check-In" : view === "riders" ? "All riders" : view === "advanced" ? "Start controls" : null;

  return (
    <>
    {/* Backdrop: the timeline stays visible; tapping outside closes (not during a start). */}
    <div className={styles.backdrop} onClick={() => { if (!busySlot) onClose(); }} data-testid="sheet-backdrop" aria-hidden="true" />
    <section
      className={`${styles.sheet} ${size === "full" ? styles.full : styles.half}`}
      role="dialog"
      aria-label={`Wave ${wave}`}
      data-testid="wave-sheet"
    >
      <div
        className={styles.handleArea}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        role="button"
        tabIndex={0}
        aria-label={size === "full" ? "Shrink panel" : "Expand panel"}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSize(size === "full" ? "half" : "full");
          if (e.key === "Escape") onClose();
        }}
      >
        <span className={styles.handle} />
      </div>

      {/* Compact header */}
      <header className={styles.head}>
        {title ? (
          <button type="button" className={styles.iconBtn} onClick={() => setView("summary")} aria-label="Back to wave">
            <ArrowLeft size={18} />
          </button>
        ) : null}
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
            {title ? <b>{title}</b> : null}
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
        {view === "summary" && (
          <>
            {otherWaveRunning && state === "upcoming" && (
              <div className={styles.warn} role="alert">
                <AlertTriangle size={15} /> Another wave is still racing — finish it before starting this one.
              </div>
            )}

            {/* Check-In */}
            <button type="button" className={styles.card} onClick={() => open("checkin")} data-testid="sheet-checkin">
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

            {/* Start, per start group (existing granularity) */}
            <div className={styles.group}>
              <div className={styles.groupTitle}><Flag size={14} /> Start</div>
              {[...slots.entries()].map(([key, cats]) => {
                const ids = cats.map((c) => c.id);
                const gState: WaveState = cats.every((c) => c.status === "finished")
                  ? "finished"
                  : cats.some((c) => c.status === "running" || c.status === "finished")
                    ? "running"
                    : "upcoming";
                const gRiders = waveRiders.filter((r) => cats.some((c) => riderInCategory(r, c)) && r.status !== "DNS").length;
                const issues = gState === "upcoming" ? validateGroup(ids) : [];
                const early = gState === "upcoming" && key !== "TBD" && nowMin < toMinutes(key);
                const time = key === "TBD" ? "No start time" : normalizeTime(key) ?? key;
                const gStarted = actualStart(cats, riders);
                const blocked = otherWaveRunning || issues.length > 0;
                return (
                  <div key={key} className={styles.startRow} data-testid={`sheet-start-${key}`}>
                    <div className={styles.startInfo}>
                      <span className={styles.startTime}>{time}</span>
                      <span className={styles.startCats} dir="auto">{cats.map((c) => c.name).join(" · ")}</span>
                    </div>
                    {gState === "upcoming" && !canStart ? (
                      <span className={`${styles.state} ${styles.state_upcoming}`}><Circle size={13} /> Upcoming</span>
                    ) : gState === "upcoming" ? (
                      confirmSlot === key ? (
                        <div className={styles.confirm} role="group" aria-label={`Confirm start of wave ${wave}`}>
                          <div className={styles.confirmText}>
                            <b>Start Wave {wave}?</b>
                            <span>Scheduled {time} · {gRiders} riders</span>
                            <span dir="auto">{cats.map((c) => c.name).join(", ")}</span>
                            {early && <span className={styles.note}>Before the scheduled time.</span>}
                          </div>
                          <div className={styles.confirmBtns}>
                            <button type="button" className={styles.secondary} onClick={() => setConfirmSlot(null)} disabled={busySlot === key}>
                              Cancel
                            </button>
                            <button type="button" className={styles.primary} onClick={() => void doStart(key, cats)} disabled={busySlot === key} data-testid="sheet-confirm-start">
                              {busySlot === key ? "Starting…" : "Confirm Start"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.startBtn}
                          disabled={blocked}
                          onClick={() => { setError(null); setConfirmSlot(key); }}
                          title={blocked ? "Resolve the warnings first" : `Start Wave ${wave}`}
                          data-testid="sheet-start"
                        >
                          <Flag size={15} /> Start
                        </button>
                      )
                    ) : (
                      <span className={`${styles.state} ${styles[`state_${gState}`]}`}>
                        {gState === "running" ? <Radio size={13} /> : <CheckCircle2 size={13} />}
                        {gState === "running" ? `Racing${gStarted ? ` · ${gStarted}` : ""}` : "Completed"}
                      </span>
                    )}
                    {issues.length > 0 && (
                      <ul className={styles.issues}>
                        {issues.map((m) => <li key={m}><AlertTriangle size={12} /> {m}</li>)}
                      </ul>
                    )}
                    {error?.slot === key && (
                      <div className={styles.err} role="alert">
                        {error.msg}
                        <button type="button" className={styles.retry} onClick={() => setConfirmSlot(key)}>Retry</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Categories */}
            <div className={styles.chips}>
              {categories.map((c) => (
                <span key={c.id} className={styles.chip} dir="auto">
                  <span className={styles.dot} style={{ background: c.color ?? "#9ca3af" }} />
                  {c.name}
                </span>
              ))}
            </div>

            <div className={styles.links}>
              <button type="button" className={styles.link} onClick={() => open("riders")} data-testid="sheet-all-riders">
                <Users size={15} /> All riders <ChevronRight size={15} />
              </button>
              <button type="button" className={styles.link} onClick={() => open("advanced")} data-testid="sheet-start-controls">
                <SlidersHorizontal size={15} /> Start controls <ChevronRight size={15} />
              </button>
            </div>
          </>
        )}

        {view === "checkin" && renderCheckIn()}
        {view === "riders" && renderAllRiders()}
        {view === "advanced" && renderAdvanced()}
      </div>
    </section>
    </>
  );
};

export default RaceSheet;
