/**
 * TV broadcast header — always on screen: logo (when the race has one), race name, LIVE /
 * FINISHED status, the wave & category context, and the large race clock. Page changes
 * happen below it, so title and clock never move.
 */
import React, { useState } from "react";
import type { SharedCategory, SharedRace } from "../../../shared/race/state";
import { categoryLabel } from "../waves/activeWaves";
import { RaceClock } from "../waves/raceClock";
import styles from "./broadcast.module.css";

export type BroadcastStatus = "live" | "finished" | "idle" | "stale" | "ended";
export type BroadcastTag = "provisional" | "official" | null;

export type ClockSpec =
  | { kind: "wave"; startedAt: number | null; finishedAt: number | null; label?: string }
  | { kind: "text"; label: string; text: string };

const STATUS_TEXT: Record<BroadcastStatus, string> = {
  live: "LIVE",
  finished: "FINISHED",
  idle: "NOT RUNNING",
  stale: "DATA DELAYED",
  ended: "UPDATES ENDED",
};

/** Only a real image reference is shown as the logo (never a guessed path). */
export const logoUrl = (image: string | null | undefined) =>
  image && /^(https?:\/\/|data:image\/)/i.test(image.trim()) ? image.trim() : null;

export function BroadcastHeader({
  race,
  status,
  tag,
  context,
  contextCategories,
  clock,
  clockOffsetMs,
}: {
  race: Partial<SharedRace>;
  status: BroadcastStatus;
  tag: BroadcastTag;
  context: string | null;
  contextCategories?: SharedCategory[];
  clock: ClockSpec;
  clockOffsetMs: number;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = logoFailed ? null : logoUrl(race.image);
  return (
    <header className={styles.header} data-testid="tv-header">
      {logo && <img className={styles.logo} src={logo} alt="" onError={() => setLogoFailed(true)} />}
      <div className={styles.titleBlock}>
        <div className={styles.brand}>Commissaire · Race Timing</div>
        <h1 className={styles.title} dir="auto" data-testid="tv-title">{race.name}</h1>
        <div className={styles.context} data-testid="tv-context">
          {context && <span className={styles.contextMain}>{context}</span>}
          {contextCategories?.map((c) => (
            <span key={c.uuid} className={styles.contextCat} dir="auto">
              <span className={styles.catBar} style={{ background: c.color ?? "#5d6b82" }} aria-hidden="true" />
              {categoryLabel(c)}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.statusBlock}>
        <span className={styles.statusPill} data-status={status} data-testid="tv-status">
          {status === "live" && <span className={styles.liveDot} aria-hidden="true" />}
          {STATUS_TEXT[status]}
        </span>
        {tag && (
          <span className={styles.tag} data-tag={tag} data-testid="tv-tag">
            {tag === "provisional" ? "Provisional" : "Official results"}
          </span>
        )}
      </div>
      <div className={styles.clockBlock}>
        <div className={styles.clockLabel}>{clock.label ?? "Race time"}</div>
        {clock.kind === "wave" ? (
          <RaceClock startedAt={clock.startedAt} finishedAt={clock.finishedAt} offsetMs={clockOffsetMs} className={styles.clock} testId="tv-clock" />
        ) : (
          <div className={styles.clock} data-testid="tv-clock">{clock.text}</div>
        )}
      </div>
    </header>
  );
}
