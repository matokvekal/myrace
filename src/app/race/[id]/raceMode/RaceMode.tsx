import React, { useState, useMemo } from "react";
import styles from "./raceMode.module.css";
import { CategoryProps } from "@/types/types";
import StartManager from "./StartManager";
import CheckIn from "./CheckIn";
import LiveBoard from "./LiveBoard";
import LiveCards from "./LiveCards";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES } from "../schedule/Schedule";
import useRiderStore from "@/stores/ridersStore";
import { Flag, Circle } from "lucide-react";

interface Props {
  raceUuid: string;
  categories: CategoryProps[];
}

type SubTab = "start" | "checkin" | "board" | "cards";

const RaceMode: React.FC<Props> = ({ raceUuid, categories }) => {
  // Group categories by time gap (same logic as Schedule view)
  const schedule = useMemo(
    () => buildSchedule(categories, DEFAULT_WAVE_GAP_MINUTES),
    [categories]
  );
  const waveNums = useMemo(() => [...schedule.keys()], [schedule]);
  const [selectedWave, setSelectedWave] = useState<number>(waveNums[0] ?? 1);
  const [subTab, setSubTab] = useState<SubTab>("start");

  const waveStatusMap = useMemo(() => {
    const map = new Map<number, "upcoming" | "running" | "finished">();
    waveNums.forEach((w) => {
      const cats = [...(schedule.get(w)?.values() ?? [])].flat();
      if (cats.length === 0) { map.set(w, "upcoming"); return; }
      if (cats.every((c) => c.status === "finished")) map.set(w, "finished");
      else if (cats.some((c) => c.status === "running")) map.set(w, "running");
      else map.set(w, "upcoming");
    });
    return map;
  }, [schedule, waveNums]);

  // All categories in the selected time-based wave (all start slots combined)
  const waveCategories = useMemo(() => {
    const startMap = schedule.get(selectedWave);
    if (!startMap) return [];
    return [...startMap.values()].flat();
  }, [schedule, selectedWave]);

  // Nudge the commissaire toward Check-In when nobody in this wave has checked in yet
  const riders = useRiderStore((state) => state.riders);
  const needsCheckIn = useMemo(() => {
    if (waveStatusMap.get(selectedWave) !== "upcoming") return false;
    const catNames = new Set(waveCategories.map((c) => c.name));
    const waveRiders = riders.filter(
      (r) => r.raceUuid === raceUuid && catNames.has(r.category)
    );
    if (waveRiders.length === 0) return false;
    return waveRiders.every(
      (r) => !r.checked && !["DNS", "DNF", "DSQ"].includes(r.status)
    );
  }, [riders, raceUuid, waveCategories, waveStatusMap, selectedWave]);

  return (
    <div className={styles.container}>
      {/* Wave selector */}
      <div className={styles.waveBar}>
        <span className={styles.waveBarLabel}>Wave:</span>
        <div className={styles.wavePills}>
          {waveNums.map((w) => {
            const startMap = schedule.get(w);
            const firstTime = startMap ? [...startMap.keys()][0] : null;
            const waveStatus = waveStatusMap.get(w);
            return (
              <button
                key={w}
                className={[
                  styles.wavePill,
                  selectedWave === w ? styles.wavePillActive : "",
                  waveStatus === "finished" ? styles.wavePillFinished : "",
                  waveStatus === "running" ? styles.wavePillRunning : "",
                ].join(" ")}
                onClick={() => setSelectedWave(w)}
              >
                {waveStatus === "finished" ? <Flag size={11} style={{ marginRight: 3, verticalAlign: "middle" }} /> : waveStatus === "running" ? <Circle size={8} fill="currentColor" style={{ marginRight: 3, verticalAlign: "middle" }} /> : null}
                {w}{firstTime && firstTime !== "TBD" ? ` · ${firstTime}` : ""}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub-tab bar */}
      <div className={styles.subTabs}>
        <button className={`${styles.subTab} ${subTab === "start" ? styles.subTabActive : ""}`} onClick={() => setSubTab("start")}>
          Grid
        </button>
        <button
          className={[
            styles.subTab,
            subTab === "checkin" ? styles.subTabActive : "",
            needsCheckIn && subTab !== "checkin" ? styles.subTabGlow : "",
          ].join(" ")}
          onClick={() => setSubTab("checkin")}
        >
          Check-In
        </button>
        <button className={`${styles.subTab} ${subTab === "cards" ? styles.subTabActive : ""}`} onClick={() => setSubTab("cards")}>
          Cards
        </button>
        <button className={`${styles.subTab} ${subTab === "board" ? styles.subTabActive : ""}`} onClick={() => setSubTab("board")}>
          Board
        </button>
      </div>

      <div className={styles.content}>
        {subTab === "start"   && <StartManager raceUuid={raceUuid} waveNum={selectedWave} categories={waveCategories} />}
        {subTab === "checkin" && <CheckIn raceUuid={raceUuid} waveNum={selectedWave} categories={waveCategories} />}
        {subTab === "cards"   && <LiveCards raceUuid={raceUuid} waveNum={selectedWave} categories={waveCategories} />}
        {subTab === "board"   && <LiveBoard raceUuid={raceUuid} waveNum={selectedWave} categories={waveCategories} />}
      </div>
    </div>
  );
};

export default RaceMode;
