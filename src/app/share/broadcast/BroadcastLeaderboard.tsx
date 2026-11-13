/**
 * TV LIVE — the provisional broadcast leaderboard. Same ranking as the LIVE tab
 * (live/liveRanking.ts, one wave at a time, never mixed); the screen decides how many rows
 * fit, the leaders stay pinned and the rest cycles page by page.
 */
import React, { useMemo } from "react";
import type { SharedCategory, SharedRace } from "../../../shared/race/state";
import { activeWaves, nextWave, waveLabel, type WaveSummary } from "../waves/activeWaves";
import { formatGap, formatRaceTime, lapsText, rankLive, type LiveEntry } from "../live/liveRanking";
import { useLiveTrend } from "../live/useLiveTrend";
import { trendLabel } from "../live/LiveRow";
import { categoryLabel } from "../waves/activeWaves";
import type { FeedFreshness } from "../feedStatus";
import { BroadcastHeader, type BroadcastStatus } from "./BroadcastHeader";
import { BroadcastFooter } from "./BroadcastPagination";
import { pagePlan } from "./paging";
import { useFitRows, usePager } from "./useBroadcast";
import styles from "./broadcast.module.css";

export interface BroadcastCommon {
  race: Partial<SharedRace>;
  waves: WaveSummary[];
  categoriesByKey: Map<string, SharedCategory>;
  clockOffsetMs: number;
  freshness: FeedFreshness;
  updatedAt: number | null;
  raceFinished: boolean;
}

export function headerStatus(freshness: FeedFreshness, raceFinished: boolean, running: boolean): BroadcastStatus {
  if (raceFinished) return "finished";
  if (freshness === "stale") return "stale";
  if (freshness === "ended") return "ended";
  return running ? "live" : "idle";
}

/** Rows kept free in the board for the column header and the pinned divider. */
const BOARD_CHROME_ROWS = 1;

interface Page {
  wave: WaveSummary;
  ranking: LiveEntry[];
  pinned: number;
  slice: [number, number];
}

export function BroadcastLive(props: BroadcastCommon) {
  const { race, waves, categoriesByKey, clockOffsetMs, freshness, updatedAt, raceFinished } = props;
  const active = useMemo(() => activeWaves(waves), [waves]);
  const [boardRef, rows] = useFitRows();
  const per = Math.max(3, rows - BOARD_CHROME_ROWS);

  const rankings = useMemo(() => active.map((w) => ({ wave: w, ranking: rankLive(w.riders, categoriesByKey, "overall") })), [active, categoriesByKey]);
  const combined = useMemo(() => rankings.flatMap((r) => r.ranking), [rankings]);
  const viewKey = active.map((w) => w.key).join(",");
  const trend = useLiveTrend(combined, viewKey);

  const pages: Page[] = useMemo(
    () =>
      rankings.flatMap(({ wave, ranking }) => {
        const plan = pagePlan(ranking.length, per);
        return plan.pages.map((slice) => ({ wave, ranking, pinned: plan.pinned, slice }));
      }),
    [rankings, per],
  );
  const page = usePager(pages.length, undefined, viewKey);
  const current = pages[page];
  const status = headerStatus(freshness, raceFinished, active.length > 0);

  if (!current) {
    const next = nextWave(waves);
    return (
      <>
        <BroadcastHeader
          race={race}
          status={status}
          tag="provisional"
          context={next ? `Next · ${waveLabel(next.key)}` : null}
          contextCategories={next?.categories}
          clock={next?.scheduledStart ? { kind: "text", label: "Next start", text: next.scheduledStart } : { kind: "text", label: "Race time", text: raceFinished ? "Finished" : "—" }}
          clockOffsetMs={clockOffsetMs}
        />
        <div className={styles.rule} aria-hidden="true" />
        <main className={styles.main} ref={boardRef}>
          <div className={styles.panel} data-testid="tv-no-active-wave">
            <div className={styles.panelKicker}>Live standings</div>
            <h2 className={styles.panelTitle}>No Active Wave</h2>
            <p className={styles.panelText}>
              {raceFinished
                ? "The race is finished."
                : next
                  ? `Standings appear when ${waveLabel(next.key)} starts${next.scheduledStart ? ` · scheduled ${next.scheduledStart}` : ""}.`
                  : "Standings appear when a wave starts."}
            </p>
          </div>
        </main>
        <BroadcastFooter note="Provisional · live standings, not official results" page={0} pages={1} freshness={freshness} updatedAt={updatedAt} />
      </>
    );
  }

  const { wave, ranking, pinned, slice } = current;
  const pinnedRows = ranking.slice(0, pinned);
  const pageRows = ranking.slice(slice[0], slice[1]);
  return (
    <>
      <BroadcastHeader
        race={race}
        status={status}
        tag="provisional"
        context={`${waveLabel(wave.key)} · ${wave.onCourse} on course · ${wave.finished} finished`}
        contextCategories={wave.categories}
        clock={{ kind: "wave", startedAt: wave.startedAt, finishedAt: null }}
        clockOffsetMs={clockOffsetMs}
      />
      <div className={styles.rule} aria-hidden="true" />
      <main className={styles.main} ref={boardRef} data-testid="tv-live-board">
        {freshness !== "fresh" && <StaleFlag freshness={freshness} updatedAt={updatedAt} />}
        <div className={styles.board} data-stale={freshness !== "fresh" ? "true" : undefined}>
          <div className={`${styles.liveRow} ${styles.headRow}`} aria-hidden="true">
            <span>Pos</span><span>Bib</span><span>Rider</span><span>Category</span><span className={styles.num}>Laps</span>
            <span className={styles.num}>Time</span><span className={styles.num}>Gap</span><span className={styles.statusCol}>Status</span>
          </div>
          <ol className={styles.rows} aria-label={`${waveLabel(wave.key)} provisional standings`}>
            {pinnedRows.map((e) => (
              <TvLiveRow key={e.uuid} entry={e} delta={trend.deltas.get(e.uuid)} version={trend.version} />
            ))}
          </ol>
          {pinned > 0 && <div className={styles.pinDivider} aria-hidden="true" />}
          <ol key={`${wave.key}:${page}`} className={`${styles.rows} ${styles.pageIn}`} data-testid="tv-page-rows">
            {pageRows.map((e) => (
              <TvLiveRow key={e.uuid} entry={e} delta={trend.deltas.get(e.uuid)} version={trend.version} />
            ))}
          </ol>
        </div>
      </main>
      <BroadcastFooter
        note="Provisional · live standings, not official results"
        page={page}
        pages={pages.length}
        pageLabel={active.length > 1 ? waveLabel(wave.key) : null}
        freshness={freshness}
        updatedAt={updatedAt}
      />
    </>
  );
}

export function StaleFlag({ freshness, updatedAt }: { freshness: FeedFreshness; updatedAt: number | null }) {
  const at = updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—";
  return (
    <div className={styles.staleFlag} role="status" data-testid="tv-stale">
      {freshness === "ended" ? `Live updates have ended · standings from ${at}` : `Data delayed · reconnecting · standings from ${at}`}
    </div>
  );
}

function TvLiveRow({ entry, delta, version }: { entry: LiveEntry; delta?: number; version: number }) {
  const { rider, position, group, category } = entry;
  const last = rider.lastName ?? "";
  const first = [rider.firstName, rider.middleName].filter(Boolean).join(" ");
  const total = entry.totalLaps;
  return (
    <li
      className={styles.liveRow}
      data-group={group}
      data-podium={position != null && position <= 3 ? String(position) : undefined}
      data-finished={entry.finished ? "true" : undefined}
      data-moved={delta ? (delta > 0 ? "up" : "down") : undefined}
      aria-label={[position != null ? `Position ${position}` : entry.status, rider.bibNumber != null ? `bib ${rider.bibNumber}` : null, `${first} ${last}`, trendLabel(delta)].filter(Boolean).join(", ")}
      data-testid="tv-row"
    >
      {delta ? <span key={version} className={styles.flash} aria-hidden="true" /> : null}
      <span className={styles.pos}>
        {position ?? "–"}
        {delta ? <span className={styles.trend} data-trend={delta > 0 ? "up" : "down"}>{delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</span> : null}
      </span>
      <span className={styles.bibCell}><span className={styles.bib}>{rider.bibNumber ?? "—"}</span></span>
      <span className={styles.name} dir="auto">
        {first && <span className={styles.first}>{first} </span>}
        <span className={styles.last}>{last}</span>
      </span>
      <span className={styles.cat} dir="auto">
        <span className={styles.catBar} style={{ background: category?.color ?? "#5d6b82" }} aria-hidden="true" />
        <span className={styles.catText}>{category ? categoryLabel(category) : rider.category}</span>
      </span>
      <span className={`${styles.num} ${styles.laps}`}>
        {lapsText(entry)}
        {total ? <span className={styles.lapBar} aria-hidden="true"><span style={{ width: `${Math.min(100, (entry.laps / total) * 100)}%` }} /></span> : null}
      </span>
      <span className={`${styles.num} ${styles.time}`}>{group === "racing" ? formatRaceTime(entry.elapsedMs) : "—"}</span>
      <span className={`${styles.num} ${styles.gap}`} data-leader={entry.gap.kind === "leader" ? "true" : undefined}>{group === "racing" ? formatGap(entry.gap) : "—"}</span>
      <span className={styles.statusCol}><span className={styles.chip} data-status={entry.status}>{entry.status}</span></span>
    </li>
  );
}
