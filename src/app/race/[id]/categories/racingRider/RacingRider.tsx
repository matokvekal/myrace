import React, { useRef } from "react";
import styles from "./racingRider.module.css";
import { RiderProps } from "@/types/types";

interface Props {
  rider: RiderProps;
  color: string;
  forceBell?: boolean;
  isFlashing?: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}

const RacingRider: React.FC<Props> = ({ rider, color, forceBell = false, isFlashing = false, onClick, onDoubleClick }) => {
  const lastTapRef = useRef<number>(0);
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDoubleTapRef = useRef<boolean>(false);
  const clickCountRef = useRef<number>(0);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lapsRemaining = rider.totalLaps - rider.lapsCounter;
  const showBell = forceBell || (lapsRemaining === 2);
  const showStripes = forceBell || (lapsRemaining === 1);

  // Create a lighter version of the color by adding transparency
  const lighterColor = color + '40'; // Add 40% opacity (hex: 40 = ~25% alpha)

  const bgStyle = showStripes
    ? `repeating-linear-gradient(-45deg, ${color} 0px, ${color} 9px, ${lighterColor} 9px, ${lighterColor} 10px)`
    : color;

  const handleTouchEnd = (e: React.TouchEvent) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      // Double tap detected
      isDoubleTapRef.current = true;
      if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
      onDoubleClick();
      lastTapRef.current = 0;
    } else {
      // First tap - wait to see if second tap comes
      lastTapRef.current = now;
      isDoubleTapRef.current = false;
      if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = setTimeout(() => {
        if (!isDoubleTapRef.current) {
          onClick();
        }
      }, 300);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    // Only fire on desktop (no touch)
    if ((e as any).clientX === 0 && (e as any).clientY === 0) return; // Skip synthetic clicks

    // Desktop double-click detection
    clickCountRef.current++;

    if (clickCountRef.current === 1) {
      // Wait to see if a second click comes within 300ms
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = setTimeout(() => {
        if (clickCountRef.current === 1) {
          onClick(); // Single click
        }
        clickCountRef.current = 0;
      }, 300);
    } else if (clickCountRef.current === 2) {
      // Double click detected
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
      onDoubleClick();
      clickCountRef.current = 0;
    }
  };

  const glowClass = isFlashing ? styles.flash : "";

  return (
    <div
      className={`${styles.rider} ${showStripes ? styles.penultimate : ""} ${glowClass}`}
      style={{ background: bgStyle, "--glow-color": color } as React.CSSProperties}
      onClick={handleClick}
      onDoubleClick={(e) => { e.preventDefault(); }}
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
          {lapsRemaining === 1 ? 'Last' : `${Math.max(0, lapsRemaining)} left`}
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
