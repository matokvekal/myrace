import React, { useRef } from "react";
import styles from "./racingRider.module.css";
import { RiderProps } from "@/types/types";

interface Props {
  rider: RiderProps;
  color: string;
  forceBell?: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}

const RacingRider: React.FC<Props> = ({ rider, color, forceBell = false, onClick, onDoubleClick }) => {
  const lastTapRef = useRef<number>(0);

  const lapsRemaining = rider.totalLaps - rider.lapsCounter;
  const showBell = forceBell || (lapsRemaining === 2);
  const showStripes = forceBell || (lapsRemaining === 1);

  const bgStyle = showStripes
    ? `repeating-linear-gradient(-45deg, ${color} 0px, ${color} 11px, rgba(255,255,255,0.32) 11px, rgba(255,255,255,0.32) 18px)`
    : color;

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
      className={`${styles.rider} ${showStripes ? styles.penultimate : ""}`}
      style={{ background: bgStyle }}
      onClick={onClick}
      onDoubleClick={(e) => { e.preventDefault(); onDoubleClick(); }}
      onTouchEnd={handleTouchEnd}
    >
      {showBell && (
        <div className={styles.bellBadge} title={`2 laps left! (${rider.lapsCounter}/${rider.totalLaps})`}>
          🔔
        </div>
      )}
      <div className={styles.bib}>{rider.bibNumber}</div>
      <div className={styles.laps}>
        {rider.lapsCounter}/{rider.totalLaps}
      </div>
      {rider.totalLaps > 0 && (
        <div className={styles.remaining}>
          {Math.max(0, rider.totalLaps - rider.lapsCounter)} left
        </div>
      )}
      {rider.elapsedLastLap && (
        <div className={styles.lapTime}>{rider.elapsedLastLap}</div>
      )}
      <div className={styles.pos}>{rider.position_category ?? "—"}</div>
    </div>
  );
};

export default RacingRider;
