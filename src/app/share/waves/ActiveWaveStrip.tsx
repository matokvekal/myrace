/**
 * RACE tab (public page 2.0): the running wave(s) at the top — wave, RUNNING, actual start,
 * categories, on course / finished counts and the race clock. With nothing running it says
 * what is next (or that every wave is done) and never shows a LIVE marker.
 */
import React from "react";
import { Flag, Radio, Timer } from "lucide-react";
import { STATUS_LABEL } from "@/utils/statusLabels";
import { activeWaves, categoryLabel, nextWave, waveLabel, type WaveSummary } from "./activeWaves";
import { RaceClock } from "./raceClock";
import styles from "./activeWave.module.css";

export const startClock = (ms: number | null) =>
  ms == null ? null : new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ActiveWaveStrip({
  waves,
  clockOffsetMs,
  raceFinished,
  onOpenLive,
}: {
  waves: WaveSummary[];
  clockOffsetMs: number;
  raceFinished: boolean;
  onOpenLive?: () => void;
}) {
  const active = activeWaves(waves);
  if (active.length === 0) {
    const next = nextWave(waves);
    const allDone = waves.length > 0 && waves.every((w) => w.state === "finished");
    return (
      <section className={styles.idle} data-testid="share-no-active-wave" aria-label="Wave status">
        <span className={styles.idleIcon} aria-hidden="true">{allDone || raceFinished ? <Flag size={18} /> : <Timer size={18} />}</span>
        <span className={styles.idleText}>
          {raceFinished ? (
            <><strong>Race finished</strong><span>Official results are in RESULTS.</span></>
          ) : allDone ? (
            <><strong>All waves finished</strong><span>Results are published once the race is officially finished.</span></>
          ) : next ? (
            <>
              <strong>Next: {waveLabel(next.key)}{next.scheduledStart ? ` · ${next.scheduledStart}` : ""}</strong>
              <span dir="auto">{next.categories.map(categoryLabel).join(" · ")}</span>
            </>
          ) : (
            <><strong>No wave running</strong><span>The schedule is below.</span></>
          )}
        </span>
      </section>
    );
  }
  return (
    <div className={styles.stack}>
      {active.map((w) => (
        <section key={w.key} className={styles.active} data-testid="share-active-wave" aria-label={`${waveLabel(w.key)} running`}>
          <div className={styles.top}>
            <span className={styles.liveTag}><Radio size={13} aria-hidden="true" /> {STATUS_LABEL.running}</span>
            <h2 className={styles.waveName}>{waveLabel(w.key)}</h2>
            <RaceClock startedAt={w.startedAt} finishedAt={null} offsetMs={clockOffsetMs} className={styles.clock} testId="share-active-wave-clock" />
          </div>
          <p className={styles.meta}>
            {startClock(w.startedAt) && <span>Started {startClock(w.startedAt)}</span>}
            <span dir="auto">{w.categories.map(categoryLabel).join(" · ")}</span>
          </p>
          <div className={styles.counts}>
            <span className={styles.count}><b>{w.onCourse}</b> on course</span>
            <span className={styles.count}><b>{w.finished}</b> finished</span>
            {w.out > 0 && <span className={styles.count}><b>{w.out}</b> DNF/DSQ/DNS</span>}
            {onOpenLive && (
              <button type="button" className={styles.liveLink} onClick={onOpenLive} data-testid="share-open-live">
                Live standings →
              </button>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
