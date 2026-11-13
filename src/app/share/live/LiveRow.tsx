/**
 * One LIVE leaderboard row (public page 2.0). Compact, one line per rider; the grid adapts
 * to the available width (container queries in live.module.css):
 *   < 600px   POS · BIB · NAME (category · status) · LAPS · GAP/TIME · TREND
 *   ≥ 600px   + CATEGORY and STATUS columns
 *   ≥ 1024px  TIME and GAP in their own columns
 * Status is always written out (never colour only); the trend has a spoken label.
 */
import React, { memo } from "react";
import { formatGap, formatRaceTime, lapsText, riderName, type LiveEntry } from "./liveRanking";
import { categoryLabel } from "../waves/activeWaves";
import { showsArrow, type RankMotion } from "./rankMotion";
import { MAX_STAGGER_STEPS, MOTION_MS, STAGGER_MS } from "./useRankFlip";
import styles from "./live.module.css";

export function trendLabel(delta: number | undefined): string | null {
  if (!delta) return null;
  const n = Math.abs(delta);
  return `${delta > 0 ? "up" : "down"} ${n} place${n === 1 ? "" : "s"}`;
}

/** When the arrival border of a primary mover starts: once its glide (and stagger) is nearly done. */
export const ringDelayMs = (m: RankMotion) => Math.round(MOTION_MS.primary * 0.85) + Math.min(m.order, MAX_STAGGER_STEPS) * STAGGER_MS;

/**
 * `delta` = places gained since the last genuine update (spoken for every rider: a fact);
 * `motion` = primary movement only (rankMotion.ts) - the arrow, highlight and border are
 * reserved for it; displaced riders just glide.
 */
function LiveRowImpl({ entry, delta, motion, version }: { entry: LiveEntry; delta?: number; motion?: RankMotion; version: number }) {
  const { rider, position, group, category } = entry;
  const cat = category ? categoryLabel(category) : rider.category ?? "";
  const gap = group === "racing" ? formatGap(entry.gap) : "—";
  const time = formatRaceTime(entry.elapsedMs);
  const trend = trendLabel(delta);
  const arrow = showsArrow(motion) ? motion.delta : 0;
  const out = group === "out";
  const label = [
    position != null ? `Position ${position}` : out ? entry.status : "No position yet",
    rider.bibNumber != null ? `bib ${rider.bibNumber}` : null,
    riderName(rider),
    cat,
    `${lapsText(entry)} laps`,
    group === "racing" ? `time ${time}, ${gap === "Leader" ? "leader" : `gap ${gap}`}` : null,
    out ? null : entry.status,
    trend,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <li
      className={styles.row}
      data-group={group}
      data-finished={entry.finished ? "true" : undefined}
      data-podium={position != null && position <= 3 ? String(position) : undefined}
      data-moved={arrow ? (arrow > 0 ? "up" : "down") : undefined}
      data-motion={motion?.kind}
      data-uuid={entry.uuid}
      aria-label={label}
      data-testid="live-row"
    >
      {arrow ? <span key={version} className={styles.flash} aria-hidden="true" /> : null}
      {arrow ? <span key={`r${version}`} className={styles.ring} data-kind={motion!.kind} style={{ animationDelay: `${ringDelayMs(motion!)}ms` }} aria-hidden="true" /> : null}
      <span className={styles.pos} aria-hidden="true">{position ?? "–"}</span>
      <span className={styles.bib} aria-hidden="true">{rider.bibNumber ?? "—"}</span>
      <span className={styles.main} aria-hidden="true">
        <span className={styles.name} dir="auto">{riderName(rider)}</span>
        <span className={styles.sub}>
          <span className={styles.swatch} style={{ background: category?.color ?? "var(--border-card)" }} />
          <span dir="auto" className={styles.subCat}>{cat}</span>
          <span className={styles.subStatus} data-status={entry.status}>{entry.status}</span>
        </span>
      </span>
      <span className={styles.cat} aria-hidden="true" dir="auto">
        <span className={styles.swatch} style={{ background: category?.color ?? "var(--border-card)" }} />
        {cat}
      </span>
      <span className={styles.laps} aria-hidden="true">{lapsText(entry)}</span>
      <span className={styles.time} aria-hidden="true">
        <span className={styles.gap} data-leader={entry.gap.kind === "leader" ? "true" : undefined}>{gap}</span>
        <span className={styles.elapsed}>{time}</span>
      </span>
      <span className={styles.status} aria-hidden="true" data-status={entry.status}>{entry.status}</span>
      <span className={styles.trend} aria-hidden="true" data-trend={arrow ? (arrow > 0 ? "up" : "down") : "none"}>
        {arrow ? `${arrow > 0 ? "▲" : "▼"}${Math.abs(arrow)}` : ""}
      </span>
    </li>
  );
}

export const LiveRow = memo(LiveRowImpl);

/** Column labels (≥ 600px only; rows carry their own spoken labels). */
export function LiveHeaderRow() {
  return (
    <div className={`${styles.row} ${styles.headRow}`} aria-hidden="true">
      <span className={styles.pos}>Pos</span>
      <span className={styles.bib}>Bib</span>
      <span className={styles.main}>Rider</span>
      <span className={styles.cat}>Category</span>
      <span className={styles.laps}>Laps</span>
      <span className={styles.time}>
        <span className={styles.gap}>Gap</span>
        <span className={styles.elapsed}>Time</span>
      </span>
      <span className={styles.status}>Status</span>
      <span className={styles.trend} />
    </div>
  );
}
