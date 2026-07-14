import React, { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import styles from "./headerHeat.module.css";
import useRaceStore from "@/stores/racesStore";
import { Settings } from "lucide-react";
import RacePhaseSwitcher from "../racePhaseSwitcher/RacePhaseSwitcher";

function HeaderHeat({ raceId, onSettingsClick }: { raceId: string; onSettingsClick?: () => void }) {
  const params = useParams();
  const heatId = params?.heatId ? parseInt(params.heatId as string, 10) : null;
  const [currentTime, setCurrentTime] = useState<string>("");
  const races = useRaceStore((s) => s.races);

  const race = useMemo(
    () => races.find((r) => r.uuid === raceId),
    [races, raceId]
  );

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const formattedTime = now.toLocaleTimeString("en-GB", { hour12: false });
      setCurrentTime(formattedTime);
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className={styles.headerRace}>
      <div className={styles.leftSection}>
        <div className={styles.raceInfo}>
          <div className={styles.raceLiveLabel}>
            <span className={styles.liveDot}>●</span>
            RACE LIVE
          </div>
          <div className={styles.raceName}>{race?.name || "Race"}</div>
          {heatId && <div className={styles.waveLabel}>Wave {heatId}</div>}
        </div>
      </div>

      {/* Always-visible Setup / Race / Live switcher (icon-only on phones) */}
      <RacePhaseSwitcher compact />

      <div className={styles.rightSection}>
        <div className={styles.timeDisplay}>
          <div className={styles.timeLabel}>Clock</div>
          <div className={styles.time}>{currentTime}</div>
        </div>
        <button className={styles.settingsBtn} onClick={onSettingsClick} title="Voice settings">
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
}

export default HeaderHeat;
