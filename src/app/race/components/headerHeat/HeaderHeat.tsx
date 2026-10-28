import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import styles from "./headerHeat.module.css";
import useRaceStore from "@/stores/racesStore";
import useCategoryStore from "@/stores/categoryStore";
import { Eraser } from "lucide-react";
import RaceTopBar from "../raceSidebar/RaceTopBar";
import { effectiveRaceStatus } from "@/utils/raceStatus";

function HeaderHeat({
  raceId,
  onClearBoard,
}: {
  raceId: string;
  /** Set only once the wave has stopped and the board isn't cleared yet. */
  onClearBoard?: () => void;
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
  // ...and only once it has actually been started: a category of this race is
  // running (the existing lifecycle). The date-based status alone made a new,
  // unstarted race dated today read "RACE LIVE".
  const anyCategoryRunning = useCategoryStore((s) =>
    s.categories.some((c) => c.raceUuid === raceId && c.status === "running")
  );
  const isLive =
    !race?.viewOnly &&
    !race?.finalized &&
    anyCategoryRunning &&
    effectiveRaceStatus(race?.status, race?.date) === "running";

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

  // Live keeps its own controls in the shared race top bar's right-hand slot.
  return (
    <RaceTopBar>
      {isLive ? (
        <div className={styles.raceLiveLabel}>
          <span className={styles.liveDot}>●</span>
          {t("heat.raceLive", "RACE LIVE")}
        </div>
      ) : (
        <div className={styles.racePastLabel}>{t("heat.racePast", "RACE PAST")}</div>
      )}
      <div className={styles.timeDisplay} aria-label={t("heat.clock", "Clock")}>
        {currentTime}
      </div>
      {/* Clear board (BUGS.md #14) appears only when it can be used; every Live
          setting lives in the main side menu → Timing & Live Controls. */}
      {onClearBoard && (
        <button
          type="button"
          className={styles.clearBoardBtn}
          onClick={onClearBoard}
          title={t("heat.clearBoardTitle", "Reset the clock and clear the rider cards; results stay in Results")}
          data-testid="clear-board-btn"
        >
          <Eraser size={16} aria-hidden="true" />
          <span>{t("heat.clearBoard", "Clear board")}</span>
        </button>
      )}
    </RaceTopBar>
  );
}

export default HeaderHeat;
