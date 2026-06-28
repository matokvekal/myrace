import React, { useRef, useMemo } from "react";
import styles from "./racingRider.module.css";
import { RiderProps } from "@/types/types";

interface Props {
  rider: RiderProps;
  color: string;
  forceBell?: boolean;
  isLeaderInCategory?: boolean; // Top 5 in category
  onClick: () => void;
  onDoubleClick: () => void;
}

// Calculate luminance to determine if text should be light or dark
const getLuminance = (hexColor: string): number => {
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const lr = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const lg = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const lb = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};

const RacingRider: React.FC<Props> = ({ rider, color, forceBell = false, isLeaderInCategory = false, onClick, onDoubleClick }) => {
  const lastTapRef = useRef<number>(0);

  // Show bell when ENTERING penultimate lap (one lap before last)
  const showBell = forceBell || (rider.totalLaps > 0 && rider.lapsCounter === rider.totalLaps - 2);

  // Show diagonal lines when ON the last lap
  const showDiagonals = rider.totalLaps > 0 && rider.lapsCounter === rider.totalLaps - 1;

  const isFinished = rider.raceStatus === "finished";

  const isDarkBg = useMemo(() => {
    try {
      return getLuminance(color) < 0.5;
    } catch {
      return false;
    }
  }, [color]);

  const handleTouchEnd = (e: React.TouchEvent) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      e.preventDefault(); // block the click that would record a lap
      onDoubleClick();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };

  return (
    <div
      className={`${styles.rider} ${showDiagonals ? styles.penultimate : ""} ${isLeaderInCategory ? styles.leaderInCategory : ""} ${isDarkBg ? styles.darkBg : ""} ${isFinished ? styles.finished : ""}`}
      style={{ background: color }}
      onClick={onClick}
      onDoubleClick={(e) => { e.preventDefault(); onDoubleClick(); }}
      onTouchEnd={handleTouchEnd}
    >
      {showBell && <div className={styles.bellBadge}>🔔</div>}
      {isFinished && <div className={styles.finishedFlag}>🏁</div>}
      <div className={styles.bib}>{rider.bibNumber}</div>
      <div className={styles.laps}>
        {rider.lapsCounter}/{rider.totalLaps}
      </div>
      {rider.elapsedLastLap && (
        <div className={styles.lapTime}>{rider.elapsedLastLap}</div>
      )}
      <div className={styles.posContainer}>
        <div className={styles.pos}>P{rider.position_category ?? "—"}</div>
        {isLeaderInCategory && <span className={styles.leaderStar}>⭐</span>}
      </div>
    </div>
  );
};

export default RacingRider;
