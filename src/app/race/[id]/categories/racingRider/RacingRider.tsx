import React, { useRef, useState, useEffect } from "react";
import styles from "./racingRider.module.css";
import { RiderProps } from "@/types/types";
import { formatTime } from "@/utils/timeUtils";
import { Bell } from "lucide-react";

function parseTimeToMs(t: string | null | undefined): number | null {
  if (!t) return null;
  if (t.includes("T")) return new Date(t).getTime();
  const today = new Date();
  const [h, m, s = 0] = t.split(":").map(Number);
  today.setHours(h, m, s, 0);
  return today.getTime();
}

interface Props {
  rider: RiderProps;
  color: string;
  forceBell?: boolean;
  isFlashing?: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}

const RacingRider: React.FC<Props> = ({ rider, color, forceBell = false, isFlashing = false, onClick, onDoubleClick }) => {
  const clickCountRef = useRef<number>(0);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lapsRemaining = rider.totalLaps - rider.lapsCounter;
  const showBell = forceBell || (lapsRemaining === 2);
  const showStripes = forceBell || (lapsRemaining === 1);

  // Live ticking clock: how long since this rider last crossed (or since race start if never)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const sinceArriveBaseline = parseTimeToMs(rider.timeArrive) ?? parseTimeToMs(rider.timeStartRace);
  const sinceArrive = sinceArriveBaseline != null
    ? formatTime((now - sinceArriveBaseline) / 1000)
    : null;

  // Last completed lap's time — read straight from lapsDetails (the authoritative,
  // per-lap history) rather than the separately-tracked elapsedLastLap field, which
  // can end up stale/blank depending on which code path last touched the rider.
  const lastLap = rider.lapsDetails && rider.lapsDetails.length > 0
    ? rider.lapsDetails[rider.lapsDetails.length - 1]
    : null;
  const lastLapTime = lastLap?.lapTime ?? rider.elapsedLastLap ?? null;

  const bgStyle = color;

  // Single source of truth for tap disambiguation: the browser always eventually fires
  // a 'click' event, for touch and mouse alike (the viewport meta tag already kills the
  // old 300ms mobile click delay). A separate touchend-based detector used to run in
  // parallel with this one — two independent state machines reacting to the same taps —
  // which could desync and swallow a double-tap on active (still-racing) riders.
  const handleClick = (e: React.MouseEvent) => {
    clickCountRef.current++;

    if (clickCountRef.current === 1) {
      // Wait to see if a second click comes within 300ms
      if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = setTimeout(() => {
        if (clickCountRef.current === 1) {
          onClick(); // Single click
          setNow(Date.now()); // snap the "since arrive" clock to 0 right away, don't wait for the next tick
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
      className={`${styles.rider} ${glowClass}`}
      style={{ background: bgStyle, "--glow-color": color } as React.CSSProperties}
      onClick={handleClick}
      onDoubleClick={(e) => { e.preventDefault(); }}
    >
      {showBell && (
        <div className={styles.bellBadge} title={`2 laps left! (${rider.lapsCounter}/${rider.totalLaps})`}>
          <Bell size={16} color="#ffd60a" fill="#ffd60a" />
        </div>
      )}
      {showStripes && (
        <div className={styles.flagBadge} title={`Last lap! (${rider.lapsCounter}/${rider.totalLaps})`}>
          <div className={styles.flagCloth} />
          <div className={styles.flagPole} />
        </div>
      )}
      <div className={styles.bib}>{rider.bibNumber}</div>
      <div className={styles.laps}>
        <span className={styles.lapsLabel}>finish:</span>
        {rider.lapsCounter}/{rider.totalLaps}
      </div>
      {rider.totalLaps > 0 && (
        <div className={styles.remaining}>
          {lapsRemaining === 1 ? 'Last' : `${Math.max(0, lapsRemaining)} left`}
        </div>
      )}
      {(lastLapTime || sinceArrive) && (
        <div className={styles.lapTime}>
          <span className={styles.lapTimeCell}>{lastLapTime ?? "--:--"}</span>
          <span className={styles.lapTimeCell}>{sinceArrive ?? "--:--"}</span>
        </div>
      )}
      <div className={`${styles.pos} ${typeof rider.position_category === "number" && rider.position_category >= 1 && rider.position_category <= 3 ? styles.posPodium : ""}`}>{rider.position_category ?? "—"}</div>
    </div>
  );
};

export default RacingRider;
