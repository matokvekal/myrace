import React, { useRef } from "react";
import styles from "./finishRider.module.css";
import { RiderProps } from "@/types/types";
import { riderTotalTime } from "@/utils/timeUtils";

interface Props {
  rider: RiderProps;
  color: string;
  onDoubleClick: () => void;
}

const FinishRider: React.FC<Props> = ({ rider, color, onDoubleClick }) => {
  const lastTapRef = useRef<number>(0);

  const isOut = rider.status === "DNF" || rider.status === "DSQ" || rider.status === "DNS";
  const label = isOut ? rider.status : "FIN";

  const handleTouchEnd = (e: React.TouchEvent) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      e.preventDefault();
      onDoubleClick();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };

  return (
    <div
      data-testid={`finish-rider-${rider.bibNumber}`}
      data-status={label}
      className={`${styles.rider} ${isOut ? styles.out : styles.fin}`}
      style={{ borderColor: color, borderTopColor: color }}
      onDoubleClick={(e) => { e.preventDefault(); onDoubleClick(); }}
      onTouchEnd={handleTouchEnd}
    >
      <div className={styles.bib}>{rider.bibNumber}</div>
      {!isOut && (
        <div className={styles.flag} title="Finished">
          <div className={styles.flagCloth} />
          <div className={styles.flagPole} />
        </div>
      )}
      <div className={`${styles.badge} ${isOut ? styles.badgeOut : styles.badgeFin}`}>
        {label}
      </div>
      {rider.totalLaps > 0 && (
        <div className={styles.laps}>
          {rider.lapsCounter}/{rider.totalLaps}
        </div>
      )}
      {!isOut && <div className={styles.pos}>P{rider.position_category ?? "—"}</div>}
      <div className={styles.time}>
        {riderTotalTime(rider)}
      </div>
    </div>
  );
};

export default FinishRider;
