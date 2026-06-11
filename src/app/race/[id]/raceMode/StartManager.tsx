import React, { useState, useEffect, useRef } from "react";
import styles from "./startManager.module.css";
import { CategoryProps } from "@/types/types";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import useRaceStore from "@/stores/racesStore";
import { useNavigate } from "react-router-dom";
import Icons from "@/constants/Icons";

interface Props {
  raceUuid: string;
  waveNum: number;
  categories: CategoryProps[];
}

/** Group categories by startTime within a wave */
function groupByStart(cats: CategoryProps[]) {
  const map = new Map<string, CategoryProps[]>();
  for (const cat of [...cats].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""))) {
    const key = cat.startTime ?? "TBD";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(cat);
  }
  return map;
}

const Countdown: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const [count, setCount] = useState(60);
  useEffect(() => {
    if (count <= 0) { onDone(); return; }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [count, onDone]);

  return (
    <div className={styles.countdownOverlay}>
      <div className={styles.countdownNum}>{count}</div>
      <div className={styles.countdownLabel}>seconds to start</div>
      <button className={styles.countdownCancel} onClick={onDone}>Cancel</button>
    </div>
  );
};

const StartManager: React.FC<Props> = ({ raceUuid, waveNum, categories }) => {
  const navigate = useNavigate();
  const { updateCategory } = useCategoryStore();
  const { riders, updateAllRiders } = useRiderStore();
  const { races, updateRace } = useRaceStore();
  const [countdown, setCountdown] = useState<string | null>(null); // startTime key

  const startGroup = async (startTime: string, cats: CategoryProps[]) => {
    const now = new Date().toLocaleTimeString();
    const race = races.find((r) => r.uuid === raceUuid);
    if (race) await updateRace({ ...race, status: "running" });

    for (const cat of cats) {
      if (cat.status !== "upcoming") continue;
      const catRiders = riders.filter((r) => r.category === cat.name && r.raceUuid === raceUuid && r.status !== "DNS");
      const updatedCat = { ...cat, status: "running" as const, startTime: now, lapsCounter: 0, riders: catRiders.length };
      await updateCategory(updatedCat);
      const updatedRiders = catRiders.map((r, i) => ({
        ...r, raceStatus: "running" as const, timeStartRace: now, lapsCounter: 0, viewOrder: r.position_start ?? i + 1,
      }));
      await updateAllRiders(updatedRiders);
    }
  };

  const startGroups = groupByStart(categories);

  if (!categories.length) {
    return <div className={styles.empty}>No categories in this wave.</div>;
  }

  return (
    <div className={styles.container}>
      {countdown && <Countdown onDone={() => setCountdown(null)} />}

      {[...startGroups.entries()].map(([startTime, cats], si) => {
        const allRunning = cats.every((c) => c.status !== "upcoming");
        return (
          <div key={startTime} className={styles.startBlock}>
            <div className={styles.startHeader}>
              <span className={styles.startLabel}>Start {si + 1}</span>
              {startTime !== "TBD" && <span className={styles.startTime}>{startTime}</span>}
            </div>

            <div className={styles.catList}>
              {cats.map((cat) => (
                <div key={cat.id} className={styles.catRow}>
                  <div className={styles.colorDot} style={{ background: cat.color ?? "#ccc" }} />
                  <span className={styles.catName}>{cat.name}</span>
                  <span className={`${styles.statusTag} ${cat.status === "running" ? styles.running : cat.status === "finished" ? styles.finished : ""}`}>
                    {cat.status ?? "upcoming"}
                  </span>
                </div>
              ))}
            </div>

            <div className={styles.actions}>
              {!allRunning && (
                <>
                  <button className={styles.countdownBtn} onClick={() => setCountdown(startTime)}>
                    ⏱ 1 Min
                  </button>
                  <button className={styles.startBtn} onClick={() => startGroup(startTime, cats)}>
                    <img src={Icons.buttonStart} alt="" width={14} height={14} />
                    Start All
                  </button>
                </>
              )}
              {allRunning && (
                <button className={styles.liveBtn} onClick={() => navigate(`/race/${raceUuid}/heat/${waveNum}`)}>
                  Go Live →
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default StartManager;
