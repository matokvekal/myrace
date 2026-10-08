import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import styles from "./headerHeat.module.css";
import useRaceStore from "@/stores/racesStore";
import { Settings } from "lucide-react";
import RacePhaseSwitcher from "../racePhaseSwitcher/RacePhaseSwitcher";
import { effectiveRaceStatus } from "@/utils/raceStatus";

function HeaderHeat({
  raceId,
  onSettingsClick,
}: {
  raceId: string;
  onSettingsClick?: () => void;
}) {
  const { t } = useTranslation();
  const [currentTime, setCurrentTime] = useState<string>("");
  const races = useRaceStore((s) => s.races);

  const race = useMemo(
    () => races.find((r) => r.uuid === raceId),
    [races, raceId]
  );

  // Whether the RACE ITSELF is live — not whether the currently viewed wave
  // happens to be running. A finished/upcoming-but-past race, or a read-only
  // downloaded copy, is never "live" even while looking at its heat screen.
  const isLive =
    !race?.viewOnly && effectiveRaceStatus(race?.status, race?.date) === "running";

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
        <div className={styles.raceName}>{race?.name || t("heat.defaultRaceName", "Race")}</div>
      </div>

      {/* Always-visible Setup / Race / Live switcher (icon-only on phones) */}
      <RacePhaseSwitcher compact />

      <div className={styles.rightSection}>
        <div className={styles.liveWaveGroup}>
          {isLive ? (
            <div className={styles.raceLiveLabel}>
              <span className={styles.liveDot}>●</span>
              {t("heat.raceLive", "RACE LIVE")}
            </div>
          ) : (
            <div className={styles.racePastLabel}>{t("heat.racePast", "RACE PAST")}</div>
          )}
        </div>
        <div className={styles.timeDisplay}>
          <div className={styles.timeLabel}>{t("heat.clock", "Clock")}</div>
          <div className={styles.time}>{currentTime}</div>
        </div>
        <button className={styles.settingsBtn} onClick={onSettingsClick} title={t("heat.liveSettingsTitle", "Live settings")}>
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
}

export default HeaderHeat;
