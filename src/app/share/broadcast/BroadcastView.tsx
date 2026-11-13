/**
 * TV broadcast mode (public page 2.0) — `/share/:token?view=tv[&tab=race|results|live]`.
 * A dedicated full-screen 16:9 presentation (1080p → 4K: every size is in em of a font
 * derived from the screen), not an enlarged phone page. Same feed, same rules:
 * waves (activeWaves.ts), LIVE ranking (liveRanking.ts), RESULTS order (officialOrder.ts).
 *
 * Unattended: no scrolling, pages rotate on their own, the screen is kept awake, stale data
 * is flagged. Controls (tabs, fullscreen, exit) appear only on pointer/keyboard use;
 * Escape (outside fullscreen) leaves TV mode.
 */
import React, { useEffect } from "react";
import { Maximize, Minimize, X } from "lucide-react";
import type { SharedCategory, SharedRace } from "../../../shared/race/state";
import type { CategoryApprovalView } from "../../../shared/race/approval";
import type { PublicRider } from "../usePublicRaceFeed";
import type { ShareTab } from "../publicRefresh";
import type { WaveSummary } from "../waves/activeWaves";
import type { FeedFreshness } from "../feedStatus";
import { BroadcastLive } from "./BroadcastLeaderboard";
import { BroadcastRace } from "./BroadcastRace";
import { BroadcastResults } from "./BroadcastResults";
import { useRecentActivity, useWakeLock } from "./useBroadcast";
import styles from "./broadcast.module.css";

/** Browser fullscreen — only works from a user gesture (a click); failures are ignored. */
export function enterFullscreen() {
  const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
  if (!document.fullscreenElement && el.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
}
function exitFullscreen() {
  if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => undefined);
}

const TABS: { key: ShareTab; label: string }[] = [
  { key: "race", label: "Race" },
  { key: "results", label: "Results" },
  { key: "live", label: "Live" },
];

export function BroadcastView(props: {
  race: Partial<SharedRace>;
  tab: ShareTab;
  waves: WaveSummary[];
  categories: SharedCategory[];
  ridersByCat: Map<string, PublicRider[]>;
  categoriesByKey: Map<string, SharedCategory>;
  approvals: Map<string, CategoryApprovalView>;
  clockOffsetMs: number;
  freshness: FeedFreshness;
  updatedAt: number | null;
  onSelectTab: (t: ShareTab) => void;
  onExit: () => void;
}) {
  const { race, tab, onSelectTab, onExit } = props;
  const active = useRecentActivity();
  useWakeLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const common = {
    race,
    waves: props.waves,
    categoriesByKey: props.categoriesByKey,
    clockOffsetMs: props.clockOffsetMs,
    freshness: props.freshness,
    updatedAt: props.updatedAt,
    raceFinished: race.status === "finished",
  };
  const fullscreen = typeof document !== "undefined" && !!document.fullscreenElement;

  return (
    <div className={styles.tv} data-testid="tv-view" data-tab={tab} data-freshness={props.freshness} data-idle={active ? undefined : "true"}>
      {tab === "live" ? (
        <BroadcastLive {...common} />
      ) : tab === "results" ? (
        <BroadcastResults {...common} categories={props.categories} ridersByCat={props.ridersByCat} approvals={props.approvals} />
      ) : (
        <BroadcastRace {...common} />
      )}
      <nav className={styles.controls} data-visible={active ? "true" : undefined} aria-label="Broadcast controls">
        {TABS.map((t) => (
          <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => onSelectTab(t.key)} data-testid={`tv-tab-${t.key}`}>
            {t.label}
          </button>
        ))}
        <button type="button" onClick={() => (document.fullscreenElement ? exitFullscreen() : enterFullscreen())} aria-label={fullscreen ? "Exit full screen" : "Full screen"} data-testid="tv-fullscreen">
          {fullscreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => {
            exitFullscreen();
            onExit();
          }}
          aria-label="Exit TV mode"
          data-testid="tv-exit"
        >
          <X size={16} aria-hidden="true" /> Exit
        </button>
      </nav>
    </div>
  );
}
