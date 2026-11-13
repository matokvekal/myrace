/**
 * LIVE tab (public page 2.0): PROVISIONAL standings of the running wave(s), computed in the
 * browser from the public feed (liveRanking.ts). Not official results — RESULTS is.
 *
 *  - Only ACTIVE waves (activeWaves.ts). None → "No Active Wave" (never old standings).
 *  - Several active waves → a wave picker; waves are never mixed in one list.
 *  - Overall | By category; By category shows every category of the wave (sections) or one.
 *  - Position changes compared only between genuine updates (useLiveTrend).
 *  - Stale or ended feed → the last standings stay, dimmed, with when they're from.
 */
import React, { useMemo, useState } from "react";
import { AlertTriangle, Flag, Radio, Timer } from "lucide-react";
import type { SharedCategory } from "../../../shared/race/state";
import { STATUS_LABEL } from "@/utils/statusLabels";
import { activeWaves, categoryKey, categoryLabel, nextWave, waveLabel, type WaveSummary } from "../waves/activeWaves";
import { RaceClock } from "../waves/raceClock";
import type { FeedFreshness } from "../feedStatus";
import { rankLive, type LiveEntry, type LiveMode } from "./liveRanking";
import { useLiveTrend } from "./useLiveTrend";
import { LiveHeaderRow, LiveRow } from "./LiveRow";
import styles from "./live.module.css";

export interface LiveTabProps {
  waves: WaveSummary[];
  categoriesByKey: Map<string, SharedCategory>;
  clockOffsetMs: number;
  freshness: FeedFreshness;
  updatedAt: number | null;
  raceFinished: boolean;
  onOpenResults?: () => void;
}

const timeOf = (ms: number | null) => (ms ? new Date(ms).toLocaleTimeString() : "—");

export function LiveTab(props: LiveTabProps) {
  const { waves, categoriesByKey, clockOffsetMs, freshness, updatedAt, raceFinished, onOpenResults } = props;
  const active = useMemo(() => activeWaves(waves), [waves]);
  const [waveChoice, setWaveChoice] = useState<string | null>(null);
  const [mode, setMode] = useState<LiveMode>("overall");
  const [catChoice, setCatChoice] = useState("");

  const wave = active.find((w) => w.key === waveChoice) ?? active[0] ?? null;

  if (!wave) return <NoActiveWave waves={waves} raceFinished={raceFinished} onOpenResults={onOpenResults} />;

  const waveCats = wave.categories.filter((c) => wave.riders.some((r) => categoryKey(r.category, r.subCategory) === categoryKey(c.name, c.subCategory)));
  const oneCat = mode === "category" && catChoice && waveCats.some((c) => c.uuid === catChoice) ? catChoice : "";

  return (
    <div className={styles.live} data-testid="live-tab" data-freshness={freshness}>
      <p className={styles.provisional} role="note" data-testid="live-provisional">
        <b>PROVISIONAL</b>
        <span>Live standings — not official results.</span>
      </p>

      {freshness !== "fresh" && (
        <p className={styles.staleBanner} role="status" data-testid="live-stale">
          <AlertTriangle size={15} aria-hidden="true" />
          {freshness === "ended" ? `Live updates have ended · last update ${timeOf(updatedAt)}` : `Connection lost · showing standings from ${timeOf(updatedAt)}`}
        </p>
      )}

      <div className={styles.toolbar}>
        {active.length > 1 && (
          <div className={styles.segment} role="group" aria-label="Wave">
            {active.map((w) => (
              <button key={w.key} type="button" aria-pressed={w.key === wave.key} onClick={() => setWaveChoice(w.key)} data-testid="live-wave-option">
                {waveLabel(w.key)}
              </button>
            ))}
          </div>
        )}
        <div className={styles.segment} role="group" aria-label="Ranking">
          <button type="button" aria-pressed={mode === "overall"} onClick={() => setMode("overall")} data-testid="live-mode-overall">Overall</button>
          <button type="button" aria-pressed={mode === "category"} onClick={() => setMode("category")} data-testid="live-mode-category">By category</button>
        </div>
        {mode === "category" && waveCats.length > 1 && (
          <select className={styles.select} value={oneCat} onChange={(e) => setCatChoice(e.target.value)} aria-label="Category" data-testid="live-category">
            <option value="">All categories</option>
            {waveCats.map((c) => (
              <option key={c.uuid} value={c.uuid}>{categoryLabel(c)}</option>
            ))}
          </select>
        )}
      </div>

      <section className={styles.waveHead} aria-label={`${waveLabel(wave.key)} ${STATUS_LABEL.running}`}>
        <span className={styles.liveDot}><Radio size={12} aria-hidden="true" /> {STATUS_LABEL.running}</span>
        <h2>{waveLabel(wave.key)}</h2>
        <span className={styles.waveCounts}>{wave.onCourse} on course · {wave.finished} finished</span>
        <RaceClock startedAt={wave.startedAt} finishedAt={null} offsetMs={clockOffsetMs} className={styles.waveClock} testId="live-clock" />
      </section>

      {wave.riders.length === 0 ? (
        <p className={styles.empty}>No riders in this wave.</p>
      ) : mode === "overall" ? (
        <Board key={`o:${wave.key}`} title={null} riders={wave.riders} categoriesByKey={categoriesByKey} mode="overall" viewKey={`o:${wave.key}`} stale={freshness !== "fresh"} />
      ) : (
        (oneCat ? waveCats.filter((c) => c.uuid === oneCat) : waveCats).map((c) => (
          <Board
            key={`c:${wave.key}:${c.uuid}`}
            title={c}
            riders={wave.riders}
            onlyCategory={categoryKey(c.name, c.subCategory)}
            categoriesByKey={categoriesByKey}
            mode="category"
            viewKey={`c:${wave.key}:${c.uuid}`}
            stale={freshness !== "fresh"}
          />
        ))
      )}
    </div>
  );
}

function Board({
  title,
  riders,
  onlyCategory,
  categoriesByKey,
  mode,
  viewKey,
  stale,
}: {
  title: SharedCategory | null;
  riders: WaveSummary["riders"];
  /** Category key to keep (By category); filtered inside the memo so the ranking stays stable. */
  onlyCategory?: string;
  categoriesByKey: Map<string, SharedCategory>;
  mode: LiveMode;
  viewKey: string;
  stale: boolean;
}) {
  const ranking = useMemo(
    () => rankLive(onlyCategory ? riders.filter((r) => categoryKey(r.category, r.subCategory) === onlyCategory) : riders, categoriesByKey, mode),
    [riders, onlyCategory, categoriesByKey, mode],
  );
  const trend = useLiveTrend(ranking, viewKey);
  const noLaps = ranking.every((e) => e.group !== "racing");
  return (
    <section className={styles.board} data-stale={stale ? "true" : undefined} data-testid="live-board">
      {title && (
        <h3 className={styles.boardTitle}>
          <span className={styles.swatch} style={{ background: title.color ?? "var(--border-card)" }} aria-hidden="true" />
          <span dir="auto">{categoryLabel(title)}</span>
          {title.laps ? <span className={styles.boardSide}>{title.laps} laps</span> : null}
        </h3>
      )}
      {noLaps && <p className={styles.emptySmall} data-testid="live-no-laps">No lap recorded yet — positions appear after the first crossing.</p>}
      <LiveHeaderRow />
      <ol className={styles.list} aria-label={title ? `${categoryLabel(title)} live standings` : "Live standings"}>
        {ranking.map((e, i) => (
          <React.Fragment key={e.uuid}>
            {groupStart(ranking, i) && <li className={styles.divider} aria-hidden="true">{e.group === "waiting" ? "Not crossed yet" : "DNF · DSQ · DNS"}</li>}
            <LiveRow entry={e} delta={trend.deltas.get(e.uuid)} version={trend.version} />
          </React.Fragment>
        ))}
      </ol>
    </section>
  );
}

/** A divider before the first waiting / out rider (only when other riders precede them). */
const groupStart = (list: LiveEntry[], i: number) => i > 0 && list[i].group !== "racing" && list[i - 1].group !== list[i].group;

function NoActiveWave({ waves, raceFinished, onOpenResults }: { waves: WaveSummary[]; raceFinished: boolean; onOpenResults?: () => void }) {
  const next = nextWave(waves);
  const allDone = waves.length > 0 && waves.every((w) => w.state === "finished");
  return (
    <section className={styles.emptyState} data-testid="live-no-active-wave">
      <span className={styles.emptyIcon} aria-hidden="true">{raceFinished || allDone ? <Flag size={26} /> : <Timer size={26} />}</span>
      <h2>No Active Wave</h2>
      <p>
        {raceFinished
          ? "The race is finished."
          : allDone
            ? "Every wave has finished. Results are published once the race is officially finished."
            : next
              ? `Live standings appear here when ${waveLabel(next.key)} starts${next.scheduledStart ? ` (scheduled ${next.scheduledStart})` : ""}.`
              : "Live standings appear here when a wave starts."}
      </p>
      {raceFinished && onOpenResults && (
        <button type="button" className={styles.emptyBtn} onClick={onOpenResults} data-testid="live-open-results">See results</button>
      )}
    </section>
  );
}
