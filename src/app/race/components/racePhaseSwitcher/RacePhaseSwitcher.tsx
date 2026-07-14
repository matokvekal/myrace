/**
 * RacePhaseSwitcher — the single, always-visible control for moving between the
 * three race phases: Setup → Race → Live.
 *
 * Navigation only (no destructive actions). Free jump between any phase.
 * Each phase has its own accent colour so the commissaire always knows where
 * they are; the active button is filled, the others are muted.
 */
import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Sliders, Flag, Radio } from "lucide-react";
import useUIStore from "@/stores/uiStore";
import styles from "./racePhaseSwitcher.module.css";

type Phase = "setup" | "race" | "live";

/** `compact` — for tight headers (live heat): drops button labels to icon-only
 *  on narrow screens so the header's clock/settings never overflow off-screen. */
const RacePhaseSwitcher: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const navigate = useNavigate();
  const params = useParams();
  const raceUuid = params?.id as string;
  // On the live lap screen the route carries :heatId — that means we're in Live.
  const onLiveRoute = params?.heatId != null;

  const isRaceMode = useUIStore((s) => s.isRaceMode);
  const setRaceMode = useUIStore((s) => s.setRaceMode);
  const selectedWave = useUIStore((s) => s.selectedWave);

  const phase: Phase = onLiveRoute ? "live" : isRaceMode ? "race" : "setup";

  const goSetup = () => {
    if (onLiveRoute) navigate(`/race/${raceUuid}`);
    setRaceMode(false);
  };
  const goRace = () => {
    if (onLiveRoute) navigate(`/race/${raceUuid}`);
    setRaceMode(true);
  };
  const goLive = () => {
    navigate(`/race/${raceUuid}/heat/${selectedWave}`);
  };

  const items: {
    key: Phase;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    activeClass: string;
    idleClass: string;
  }[] = [
    { key: "setup", label: "Race", icon: <Sliders size={16} />, onClick: goSetup, activeClass: styles.setupActive, idleClass: styles.setupIdle },
    { key: "race", label: "Start", icon: <Flag size={16} />, onClick: goRace, activeClass: styles.raceActive, idleClass: styles.raceIdle },
    { key: "live", label: "Live", icon: <Radio size={16} />, onClick: goLive, activeClass: styles.liveActive, idleClass: styles.liveIdle },
  ];

  return (
    <div
      className={`${styles.switcher} ${compact ? styles.compactOnMobile : ""}`}
      role="tablist"
      aria-label="Race phase"
    >
      {items.map((it) => {
        const active = phase === it.key;
        return (
          <button
            key={it.key}
            role="tab"
            aria-selected={active}
            className={`${styles.btn} ${active ? `${styles.active} ${it.activeClass}` : it.idleClass}`}
            onClick={it.onClick}
          >
            {it.key === "live" && active ? (
              <span className={styles.liveDot} />
            ) : (
              it.icon
            )}
            <span className={styles.label}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default RacePhaseSwitcher;
