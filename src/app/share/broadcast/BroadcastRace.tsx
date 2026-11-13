/**
 * TV RACE — event overview: the running wave(s) as a hero panel (actual start, categories,
 * on course / finished) and the full wave schedule with scheduled or actual starts.
 */
import React, { useMemo } from "react";
import { STATUS_LABEL } from "@/utils/statusLabels";
import { activeWaves, categoryLabel, nextWave, waveLabel, type WaveSummary } from "../waves/activeWaves";
import { startClock } from "../waves/ActiveWaveStrip";
import { BroadcastHeader } from "./BroadcastHeader";
import { BroadcastFooter, chunk } from "./BroadcastPagination";
import { headerStatus, StaleFlag, type BroadcastCommon } from "./BroadcastLeaderboard";
import { useFitRows, usePager } from "./useBroadcast";
import styles from "./broadcast.module.css";

/** Schedule rows are taller than leaderboard rows (category chips wrap). */
const SCHEDULE_ROW_EM = 3.4;

export function BroadcastRace(props: BroadcastCommon) {
  const { race, waves, clockOffsetMs, freshness, updatedAt, raceFinished } = props;
  const active = useMemo(() => activeWaves(waves), [waves]);
  const next = nextWave(waves);
  const [tableRef, rows] = useFitRows(SCHEDULE_ROW_EM, 8);
  const pages = useMemo(() => chunk(waves, Math.max(1, rows - 1)), [waves, rows]);
  const page = usePager(pages.length, undefined, String(pages.length));
  const lead = active[0] ?? null;
  const status = headerStatus(freshness, raceFinished, active.length > 0);

  return (
    <>
      <BroadcastHeader
        race={race}
        status={status}
        tag={null}
        context={[race.date, race.location, lead ? `${waveLabel(lead.key)} running` : null].filter(Boolean).join(" · ") || null}
        clock={
          lead
            ? { kind: "wave", startedAt: lead.startedAt, finishedAt: null }
            : next?.scheduledStart
              ? { kind: "text", label: "Next start", text: next.scheduledStart }
              : { kind: "text", label: "Race time", text: raceFinished || waves.every((w) => w.state === "finished") ? "Finished" : "—" }
        }
        clockOffsetMs={clockOffsetMs}
      />
      <div className={styles.rule} aria-hidden="true" />
      <main className={`${styles.main} ${styles.raceGrid}`} data-testid="tv-race">
        {freshness !== "fresh" && <StaleFlag freshness={freshness} updatedAt={updatedAt} />}
        <section className={styles.hero} aria-label="Wave status">
          {active.length > 0 ? (
            active.slice(0, 2).map((w) => <HeroWave key={w.key} wave={w} />)
          ) : (
            <div className={styles.heroCard} data-state="idle" data-testid="tv-race-idle">
              <div className={styles.heroKicker}>{raceFinished ? "Race" : next ? "Next start" : "Waves"}</div>
              <div className={styles.heroTitle}>{raceFinished ? "Finished" : next ? waveLabel(next.key) : "All waves finished"}</div>
              {!raceFinished && next && (
                <>
                  <div className={styles.heroBig}>{next.scheduledStart ?? "—"}</div>
                  <div className={styles.heroCats} dir="auto">{next.categories.map(categoryLabel).join(" · ")}</div>
                </>
              )}
            </div>
          )}
        </section>
        <section className={styles.schedule} ref={tableRef} aria-label="Schedule">
          <div className={`${styles.schedRow} ${styles.headRow}`} aria-hidden="true">
            <span>Wave</span><span>Start</span><span>Categories</span><span className={styles.num}>Riders</span><span className={styles.statusCol}>Status</span>
          </div>
          <ol key={page} className={`${styles.rows} ${styles.pageIn}`}>
            {(pages[page] ?? []).map((w) => (
              <li key={w.key} className={styles.schedRow} data-state={w.state} data-testid="tv-schedule-row">
                <span className={styles.waveNo}>{w.key}</span>
                <span className={styles.num}>
                  {w.startedAt ? startClock(w.startedAt) : w.scheduledStart ?? "—"}
                  <span className={styles.startKind}>{w.startedAt ? "actual" : "scheduled"}</span>
                </span>
                <span className={styles.schedCats}>
                  {w.categories.map((c) => (
                    <span key={c.uuid} className={styles.contextCat} dir="auto">
                      <span className={styles.catBar} style={{ background: c.color ?? "#5d6b82" }} aria-hidden="true" />
                      {categoryLabel(c)}
                    </span>
                  ))}
                </span>
                <span className={styles.num}>{w.total}</span>
                <span className={styles.statusCol}><span className={styles.chip} data-wave-state={w.state}>{STATUS_LABEL[w.state]}</span></span>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <BroadcastFooter note={raceFinished ? "Race finished" : "Race overview"} page={page} pages={pages.length} freshness={freshness} updatedAt={updatedAt} />
    </>
  );
}

function HeroWave({ wave }: { wave: WaveSummary }) {
  return (
    <div className={styles.heroCard} data-state="running" data-testid="tv-active-wave">
      <div className={styles.heroKicker}><span className={styles.liveDot} aria-hidden="true" /> {STATUS_LABEL.running}</div>
      <div className={styles.heroTitle}>{waveLabel(wave.key)}</div>
      {startClock(wave.startedAt) && <div className={styles.heroSub}>Started {startClock(wave.startedAt)}</div>}
      <div className={styles.heroCats} dir="auto">{wave.categories.map(categoryLabel).join(" · ")}</div>
      <div className={styles.heroStats}>
        <span><b>{wave.onCourse}</b> on course</span>
        <span><b>{wave.finished}</b> finished</span>
        {wave.out > 0 && <span><b>{wave.out}</b> DNF/DSQ/DNS</span>}
      </div>
    </div>
  );
}
