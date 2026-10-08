import React, { useEffect } from "react";
import styles from "./liveCards.module.css";
import { CategoryProps, RiderProps } from "@/types/types";
import useRiderStore from "@/stores/ridersStore";
import RacingRider from "../categories/racingRider/RacingRider";
import FinishRider from "../categories/finishRider/FinishRider";
import calculatePositions from "@/utils/calculatePosition";
import { riderInCategory, withCategoryLaps } from "../schedule/Schedule";
import { formatTime, parseClockTime } from "@/utils/timeUtils";
import { toast } from "react-toastify";

const MIN_LAP_MS = 60 * 1000;

interface Props {
  raceUuid: string;
  waveNum: number;
  categories: CategoryProps[];
}

const LiveCards: React.FC<Props> = ({ raceUuid, categories }) => {
  const { riders, getRiders, updateRider, updateAllRiders } = useRiderStore();

  useEffect(() => { getRiders(raceUuid); }, [raceUuid, getRiders]);

  // Only categories that have actually started belong on the live cards view.
  const startedCategories = categories.filter(
    (c) => c.status === "running" || c.status === "finished"
  );
  const isRaceStarted = startedCategories.length > 0;

  // Laps resolved from the category — without this a rider whose totalLaps is 0
  // never satisfies the finish check below and can lap forever (BUGS.md #7).
  const waveRiders = withCategoryLaps(
    riders.filter(
      (r) => r.raceUuid === raceUuid && startedCategories.some((c) => riderInCategory(r, c)) && r.checked
    ),
    startedCategories
  );

  const positioned = calculatePositions([...waveRiders]);

  const getCatColor = (rider: RiderProps) => {
    const cat = startedCategories.find((c) => riderInCategory(rider, c));
    return cat?.color ?? rider.color ?? "#ccc";
  };

  const handleRiderClick = (rider: RiderProps) => {
    if (!isRaceStarted) return;
    if ((rider.totalLaps > 0 && rider.lapsCounter >= rider.totalLaps) || rider.raceStatus === "finished") return;

    const clickTime = new Date();
    if (rider.timeArrive) {
      const msSinceLast = clickTime.getTime() - new Date(rider.timeArrive).getTime();
      if (msSinceLast < MIN_LAP_MS) {
        const remaining = Math.ceil((MIN_LAP_MS - msSinceLast) / 1000);
        toast.info(`Wait ${remaining}s before next lap`);
        return;
      }
    }

    const lapsCounter = (rider.lapsCounter || 0) + 1;
    const raceStart = parseClockTime(rider.timeStartRace) ?? clickTime;
    const lastLapStart = rider.timeArrive ? new Date(rider.timeArrive) : raceStart;
    const lapMs = clickTime.getTime() - lastLapStart.getTime();
    const lapTime = formatTime(lapMs / 1000);
    const isFinished = rider.totalLaps > 0 && lapsCounter >= rider.totalLaps;

    const intermediateRider: RiderProps = {
      ...rider,
      lapsCounter,
      elapsedLastLap: lapTime,
      elapsedTimeFromStart: formatTime((clickTime.getTime() - raceStart.getTime()) / 1000),
      timeArrive: clickTime.toISOString(),
      raceStatus: isFinished ? "finished" : rider.raceStatus,
    };

    const allWithUpdated = riders.map((r) => (r.id === intermediateRider.id ? intermediateRider : r));
    const sorted = calculatePositions(allWithUpdated);
    const positionAtLap = sorted.find((r) => r.id === rider.id)?.position_category ?? rider.position_category;

    const updatedRider: RiderProps = {
      ...intermediateRider,
      position_category: positionAtLap,
      lapsDetails: [
        ...(rider.lapsDetails ?? []),
        { lap: lapsCounter, startTime: lastLapStart, endTime: clickTime, lapTime, position: positionAtLap },
      ],
    };

    updateRider(updatedRider);
    updateAllRiders(sorted.map((r) => (r.id === updatedRider.id ? updatedRider : r)));
  };

  return (
    <div className={styles.container}>
      {!isRaceStarted && (
        <div className={styles.notStartedBanner}>
          Race hasn't started yet
        </div>
      )}

      {startedCategories.map((cat) => {
        const catRiders = positioned.filter((r) => riderInCategory(r, cat));
        if (catRiders.length === 0) return null;

        // DNF/DSQ ride to the end of the list with their status. DNS never started,
        // so they are not shown on Live at all.
        const isDropped = (r: RiderProps) => ["DNF", "DSQ"].includes(r.status);
        const isDns = (r: RiderProps) => r.status === "DNS";

        const activeRiders = catRiders
          .filter((r) => !isDropped(r) && !isDns(r) && r.raceStatus !== "finished")
          .sort((a, b) =>
            (a.position_category ?? 999) - (b.position_category ?? 999) ||
            a.bibNumber - b.bibNumber
          );

        const finishedRiders = catRiders
          .filter((r) => !isDropped(r) && !isDns(r) && r.raceStatus === "finished")
          .sort((a, b) => (a.position_category ?? 999) - (b.position_category ?? 999));

        const outRiders = catRiders.filter(isDropped);

        return (
          <div key={cat.id} className={styles.catSection}>
            <div className={styles.catHeader}>
              <span className={styles.catDot} style={{ background: cat.color ?? "#ccc" }} />
              <span className={styles.catName}>{cat.name}</span>
              <span className={styles.catCount}>{catRiders.length}</span>
            </div>

            {(cat.laps ?? 0) > 0 && (() => {
              const maxLaps = catRiders.length > 0
                ? Math.max(0, ...catRiders.map((r) => r.lapsCounter || 0))
                : 0;
              return (
                <div className={styles.lapBar}>
                  {Array.from({ length: cat.laps! }, (_, i) => (
                    <div key={i} className={`${styles.lapSegment} ${i < maxLaps ? styles.lapSegmentDone : ""}`} />
                  ))}
                </div>
              );
            })()}

          <div className={styles.cardGrid}>
              {activeRiders.map((rider) => (
                <RacingRider
                  key={rider.id}
                  rider={rider}
                  color={getCatColor(rider)}
                  onClick={() => handleRiderClick(rider)}
                  onDoubleClick={() => {}}
                />
              ))}
              {finishedRiders.map((rider) => (
                <FinishRider
                  key={rider.id}
                  rider={rider}
                  color={getCatColor(rider)}
                  onDoubleClick={() => {}}
                />
              ))}
              {outRiders.map((rider) => (
                <FinishRider
                  key={rider.id}
                  rider={rider}
                  color={getCatColor(rider)}
                  onDoubleClick={() => {}}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default LiveCards;
