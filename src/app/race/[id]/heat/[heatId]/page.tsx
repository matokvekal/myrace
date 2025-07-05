"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import styles from "./heat.module.css";
import { toast } from "react-toastify";
import HeaderHeats from "../../../components/headerHeat/HeaderHeat";
import Image from "next/image";
import Icons from "@/constants/Icons";
import RacingRider from "../../categories/racingRider/RacingRider";
import FinishRider from "../../categories/finishRider/FinishRider";
import useRaceStore from "@/stores/racesStore";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import useUIStore from "@/stores/uiStore";
import { RiderProps } from "@/types/types";
import { formatTime } from "../../../../utils/timeUtils";
import calculatePositions from "../../../../utils/calculatePosition";

const Heat: React.FC = () => {
  const params = useParams();


  const raceUuid = params?.id as string;
  const heatId = params?.heatId ? parseInt(params.heatId as string, 10) : null;

  const { races, getRaces } = useRaceStore();
  const { riders, getRiders, updateRider, updateAllRiders } = useRiderStore();
  const { categories, getCategories } = useCategoryStore();
  const { modals, openModal, closeModal } = useUIStore();

  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (!raceUuid) return;
    const fetchAllData = async () => {
      if (races.length === 0) await getRaces();
      await getCategories(raceUuid);
      await getRiders(raceUuid);
    };

    fetchAllData();
  }, [raceUuid, getRaces, getCategories, getRiders, races.length]);

  const heatCategories = useMemo(() => {
    return categories
      .filter((cat) => Number(cat.heat) === heatId)
      .map((cat) => cat.name);
  }, [categories, heatId]);

  const filteredAndSortedRiders = useMemo(() => {
    return riders
      .filter((r) => heatCategories.includes(r.category))
      .filter((r) => {
        const category = categories.find((cat) => cat.name === r.category);
        return (
          category &&
          (category.status === "finished" || category.status === "running")
        );
      });
  }, [riders, heatCategories, categories]);

  const handleRiderClick = (rider: RiderProps) => {
    if (
      rider.lapsCounter === rider.totalLaps ||
      rider.raceStatus === "finished"
    )
      return;

    const now = new Date();
    const startTime = new Date("12:00:00");

    // Prevent clicking too soon
    if (rider.timeArrive) {
      const lastClick = new Date(rider.timeArrive).getTime();
      if (now.getTime() - lastClick < 2000) {
        toast.info("Rider cannot be clicked again yet");
        return;
      }
    }
    const lapsCounter = (rider.lapsCounter || 0) + 1;
    const lastLapStart = rider.timeArrive
      ? new Date(rider.timeArrive)
      : startTime;
    const formattedLastLap = formatTime(
      (now.getTime() - lastLapStart.getTime()) / 1000
    );
    const formattedTotalTime = formatTime(
      (now.getTime() - startTime.getTime()) / 1000
    );

    const updatedRider: RiderProps = {
      ...rider,
      lapsCounter,
      elapsedLastLap: formattedLastLap,
      elapsedTimeFromStart: formattedTotalTime,
      timeArrive: now.toISOString(),
      lapsDetails: [
        ...(rider.lapsDetails || []),
        {
          lap: lapsCounter,
          startTime: lastLapStart,
          endTime: now,
          lapTime: formattedLastLap
        }
      ],
      raceStatus:
        lapsCounter === rider.totalLaps ? "finished" : rider.raceStatus
    };

    updateRider(updatedRider);
    const updatedRiders = riders.map((r) =>
      r.id === updatedRider.id ? updatedRider : r
    );
    const sortedRiders = calculatePositions(updatedRiders);
    updateAllRiders(sortedRiders);
  };

  const activeRiders = useMemo(
    () => filteredAndSortedRiders.filter((r) => r.raceStatus === "running"),
    [filteredAndSortedRiders]
  );
  const finishedRiders = useMemo(() => {
    return [...filteredAndSortedRiders]
      .filter((r) => r.raceStatus !== "running")
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [filteredAndSortedRiders]);
//todo: fix the following code
//if race running, show the timer
//if race running show riders from running categories else write - heat didnt start yet or race is over
  return (
    <div className={styles.heat}>
      <HeaderHeats raceId={raceUuid} />
      <div className={styles.wrapper}>
        <div className={styles.timer}>
          <p className={styles.timer}>00:34:19</p>
        </div>

        <div className={styles.searchWrapper}>
          <div className={styles.inputContainer}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <Image
              src={Icons.search}
              alt="search"
              width={16}
              height={16}
              className={styles.inputIcon}
            />
          </div>
        </div>

        <div className={styles.gridWrapper}>
          <div className={styles.info}>
            {activeRiders.length > 0 && (
              <div className={styles.active}>
                Racing ({activeRiders.length})
              </div>
            )}
            <Image src={Icons.filter} alt="filter" width={12} height={12} />
          </div>

          <div className={styles.ridersWrapper}>
            <div className={styles.riderGrid}>
              {activeRiders.map((rider) => (
                <RacingRider
                  key={rider.id}
                  rider={rider}
                  onClick={() => handleRiderClick(rider)}
                />
              ))}
            </div>

            <div className={styles.finishers}>
              {finishedRiders.length > 0 && (
                <div>Finished ({finishedRiders.length})</div>
              )}
            </div>

            <div className={styles.riderGrid}>
              {finishedRiders.map((finisher) => (
                <FinishRider
                  key={finisher.id}
                  rider={finisher}
                  onClick={() =>
                    console.log(
                      `Clicked ${finisher.firstName} ${finisher.lastName}`
                    )
                  } // ✅ Fix: Provide a default handler
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Heat;
