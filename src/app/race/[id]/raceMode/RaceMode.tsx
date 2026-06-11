import React, { useState } from "react";
import styles from "./raceMode.module.css";
import { CategoryProps } from "@/types/types";
import StartManager from "./StartManager";
import CheckIn from "./CheckIn";
import LiveBoard from "./LiveBoard";

interface Props {
  raceUuid: string;
  categories: CategoryProps[];
}

type SubTab = "start" | "checkin" | "board";

const RaceMode: React.FC<Props> = ({ raceUuid, categories }) => {
  const waves = [...new Set(categories.map((c) => c.heat ?? 0))].sort((a, b) => a - b);
  const [selectedWave, setSelectedWave] = useState<number>(waves[0] ?? 1);
  const [subTab, setSubTab] = useState<SubTab>("start");

  const waveCategories = categories.filter((c) => (c.heat ?? 0) === selectedWave);

  return (
    <div className={styles.container}>
      {/* Wave selector */}
      <div className={styles.waveBar}>
        <span className={styles.waveBarLabel}>Wave:</span>
        <div className={styles.wavePills}>
          {waves.map((w) => (
            <button
              key={w}
              className={`${styles.wavePill} ${selectedWave === w ? styles.wavePillActive : ""}`}
              onClick={() => setSelectedWave(w)}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-tab bar */}
      <div className={styles.subTabs}>
        <button className={`${styles.subTab} ${subTab === "start" ? styles.subTabActive : ""}`} onClick={() => setSubTab("start")}>
          Start Manager
        </button>
        <button className={`${styles.subTab} ${subTab === "checkin" ? styles.subTabActive : ""}`} onClick={() => setSubTab("checkin")}>
          Check-In
        </button>
        <button className={`${styles.subTab} ${subTab === "board" ? styles.subTabActive : ""}`} onClick={() => setSubTab("board")}>
          Live Board
        </button>
      </div>

      <div className={styles.content}>
        {subTab === "start"   && <StartManager raceUuid={raceUuid} waveNum={selectedWave} categories={waveCategories} />}
        {subTab === "checkin" && <CheckIn raceUuid={raceUuid} waveNum={selectedWave} categories={waveCategories} />}
        {subTab === "board"   && <LiveBoard raceUuid={raceUuid} waveNum={selectedWave} categories={waveCategories} />}
      </div>
    </div>
  );
};

export default RaceMode;
