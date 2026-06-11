import React, { useEffect } from "react";
import styles from "./liveBoard.module.css";
import { CategoryProps, RiderProps } from "@/types/types";
import useRiderStore from "@/stores/ridersStore";
import calculatePositions from "@/utils/calculatePosition";

interface Props {
  raceUuid: string;
  waveNum: number;
  categories: CategoryProps[];
}

function elapsed(rider: RiderProps): string {
  if (!rider.timeStartRace) return "—";
  const ms = (rider.timeArrive ? new Date(rider.timeArrive) : new Date()).getTime() - new Date(rider.timeStartRace).getTime();
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}

const LiveBoard: React.FC<Props> = ({ raceUuid, waveNum, categories }) => {
  const { riders, getRiders } = useRiderStore();

  useEffect(() => { getRiders(raceUuid); }, [raceUuid, getRiders]);

  const waveRiders = riders.filter((r) => r.raceUuid === raceUuid && r.heat === waveNum);
  const positioned = calculatePositions([...waveRiders]);

  if (!categories.length) {
    return <div className={styles.empty}>No categories in this wave.</div>;
  }

  return (
    <div className={styles.container}>
      {categories.map((cat) => {
        const catRiders = positioned.filter((r) => r.category === cat.name);
        const finished = catRiders.filter((r) => r.status === "finished").length;
        const onTrack = catRiders.filter((r) => r.status === "running").length;
        const out = catRiders.filter((r) => ["DNS","DNF","DSQ"].includes(r.status)).length;
        const top5 = [...catRiders]
          .filter((r) => !["DNS","DNF","DSQ"].includes(r.status))
          .sort((a, b) => a.position_category - b.position_category)
          .slice(0, 5);

        return (
          <div key={cat.id} className={styles.catBlock}>
            <div className={styles.catHeader}>
              <span className={styles.catDot} style={{ background: cat.color ?? "#ccc" }} />
              <span className={styles.catName}>{cat.name}</span>
              <div className={styles.catStats}>
                <span className={styles.stat}>✓ {finished}</span>
                <span className={styles.stat}>⚡ {onTrack}</span>
                {out > 0 && <span className={`${styles.stat} ${styles.outStat}`}>✗ {out}</span>}
              </div>
            </div>

            {top5.length === 0 ? (
              <div className={styles.noData}>Race not started</div>
            ) : (
              top5.map((rider, i) => (
                <div key={rider.id} className={`${styles.row} ${rider.status === "running" ? styles.running : ""}`}>
                  <span className={styles.pos}>{i + 1}</span>
                  <span className={styles.bib}>#{rider.bibNumber}</span>
                  <span className={styles.name}>{rider.lastName} {rider.firstName}</span>
                  <span className={styles.laps}>{rider.lapsCounter}/{rider.totalLaps}</span>
                  <span className={styles.time}>{elapsed(rider)}</span>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
};

export default LiveBoard;
