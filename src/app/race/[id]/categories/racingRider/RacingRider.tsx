import React, { useRef } from "react";
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

const RacingRider: React.FC<Props> = ({ rider, color, forceBell = false, isLeaderInCategory = false, onClick, onDoubleClick }) => {
  const lastTapRef = useRef<number>(0);

  const isPenultimate = forceBell || (rider.totalLaps > 0 && rider.lapsCounter === rider.totalLaps - 1);

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
      className={`${styles.rider} ${isPenultimate ? styles.penultimate : ""} ${isLeaderInCategory ? styles.leaderInCategory : ""}`}
      style={{ background: color }}
      onClick={onClick}
      onDoubleClick={(e) => { e.preventDefault(); onDoubleClick(); }}
      onTouchEnd={handleTouchEnd}
    >
      {isPenultimate && <div className={styles.bellBadge}>🔔</div>}
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
