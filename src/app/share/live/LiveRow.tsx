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
import styles from "./live.module.css";

export function trendLabel(delta: number | undefined): string | null {
  if (!delta) return null;
  const n = Math.abs(delta);
  return `${delta > 0 ? "up" : "down"} ${n} place${n === 1 ? "" : "s"}`;
}

function LiveRowImpl({ entry, delta, version }: { entry: LiveEntry; delta?: number; version: number }) {
  const { rider, position, group, category } = entry;
  const cat = category ? categoryLabel(category) : rider.category ?? "";
  const gap = group === "racing" ? formatGap(entry.gap) : "—";
  const time = formatRaceTime(entry.elapsedMs);
  const trend = trendLabel(delta);
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
      data-moved={delta ? (delta > 0 ? "up" : "down") : undefined}
      aria-label={label}
      data-testid="live-row"
    >
      {delta ? <span key={version} className={styles.flash} aria-hidden="true" /> : null}
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
      <span className={styles.trend} aria-hidden="true" data-trend={delta ? (delta > 0 ? "up" : "down") : "none"}>
        {delta ? `${delta > 0 ? "▲" : "▼"}${Math.abs(delta)}` : ""}
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
