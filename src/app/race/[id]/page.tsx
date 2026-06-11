import React, { useState, useEffect, useMemo } from "react";
import styles from "./race.module.css";
import HeaderRace from "../components/headerRace/HeaderRace";
import Images from "@/constants/Images";
import RaceInfo from "../components/raceInfo/RaceInfo";
import useCategoryStore from "@/stores/categoryStore";
import useRaceStore from "@/stores/racesStore";
import useUIStore from "@/stores/uiStore";
import Riders from "./riders/Riders";
import Map from "./map/Map";
import Schedule from "./schedule/Schedule";
import Results from "./results/Results";
import Info from "./info/Info";
import RaceMode from "./raceMode/RaceMode";
import EditRiders from "./editRiders/EditRiders";
import { useParams } from "react-router-dom";
import { useDataStore } from "@/stores/appStore";

const TABS = ["schedule", "riders", "results", "edit", "map", "info"] as const;
type Tab = typeof TABS[number];

const Race: React.FC = () => {
  const params = useParams();
  const raceUuid = params?.id as string;
  const [loading, setLoading] = useState(true);

  const getRaces = useRaceStore((s) => s.getRaces);
  const races = useRaceStore((s) => s.races);
  const getCategories = useCategoryStore((s) => s.getCategories);
  const createCategoriesFromRiders = useCategoryStore((s) => s.createCategoriesFromRiders);
  const categories = useCategoryStore((s) => s.categories);
  const filteredCategories = categories.filter((c) => c.raceUuid === raceUuid);

  const isRaceMode = useUIStore((s) => s.isRaceMode);
  const { activeTab, setActiveTab } = useDataStore();

  const race = useMemo(
    () => races.find((r) => r.uuid === raceUuid) ?? null,
    [races, raceUuid]
  );

  useEffect(() => {
    const load = async () => {
      if (races.length === 0) await getRaces();
      setLoading(false);
    };
    load();
  }, [raceUuid, getRaces, races]);

  useEffect(() => {
    if (!loading && race) {
      getCategories(raceUuid).then((cats) => {
        if (!cats.length) createCategoriesFromRiders(raceUuid);
      });
    }
  }, [loading, race, raceUuid, getCategories, createCategoriesFromRiders]);

  const resolvedImage = useMemo(
    () => race
      ? (race.image?.startsWith("data:") || race.image?.startsWith("http")
          ? race.image
          : (Images[race.image as keyof typeof Images] ?? Images.defaultRaceBike))
      : Images.defaultRaceBike,
    [race]
  );

  if (loading) return <div className={styles.loading}>Loading race...</div>;
  if (!race) return <div className={styles.loading}>Race not found.</div>;

  const activeTabSafe = (TABS.includes(activeTab as Tab) ? activeTab : "schedule") as Tab;

  return (
    <div className={styles.race}>
      <div className={styles.top}>
        <div className={styles.headerRaceWrapper}>
          <HeaderRace />
        </div>
        <div className={styles.imageWrapper}>
          <img
            src={resolvedImage}
            alt="Race"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
        <div className={styles.raceInfo}>
          <RaceInfo {...race} />
        </div>
      </div>

      <div className={styles.bottom}>
        {isRaceMode ? (
          <RaceMode raceUuid={raceUuid} categories={filteredCategories} />
        ) : (
          <>
            <div className={styles.tabs}>
              {TABS.map((tab) => (
                <button
                  key={tab}
                  className={`${styles.button} ${activeTabSafe === tab ? styles.activeTab : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div className={styles.tabContent}>
              {activeTabSafe === "schedule" && (
                <Schedule raceUuid={raceUuid} categories={filteredCategories} />
              )}
              {activeTabSafe === "riders" && <Riders raceUuid={raceUuid} categories={filteredCategories} />}
              {activeTabSafe === "results" && <Results raceUuid={raceUuid} />}
              {activeTabSafe === "edit" && <EditRiders raceUuid={raceUuid} categories={filteredCategories} />}
              {activeTabSafe === "map" && <Map raceUuid={raceUuid} />}
              {activeTabSafe === "info" && <Info race={race} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Race;
