"use client";

import React, { useState, useEffect, useMemo } from "react";
import styles from "./race.module.css";
import HeaderRace from "../components/headerRace/HeaderRace";
import Images from "@/constants/Images";
import Image from "next/image";
import RaceInfo from "../components/raceInfo/RaceInfo";
import useCategoryStore from "@/stores/categoryStore";
import useRaceStore from "@/stores/racesStore";
import Riders from "./riders/Riders";
import Heats from "./heats/Heats";
import Categories from "./categories/Categories";
import Map from "./map/Map";
import { useParams } from "next/navigation";

const Race: React.FC = () => {
  const params = useParams();
  const raceUuid = params?.id as string;
  const [activeTab, setActiveTab] = useState("riders");
  const [race, setRace] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  const getRaces = useRaceStore((state) => state.getRaces);
  const races = useRaceStore((state) => state.races);

  const getCategories = useCategoryStore((state) => state.getCategories);
  const createCategoriesFromRiders = useCategoryStore(
    (state) => state.createCategoriesFromRiders
  );
  const categories = useCategoryStore((state) => state.categories);
  const filteredCategories = categories.filter((c) => c.raceUuid === raceUuid);

  // const filteredCategories = useMemo(() => {
  //   debugger
  //   return useCategoryStore
  //     .getState()
  //     .categories.filter((c) => c.raceUuid === raceUuid);
  // }, [raceUuid]);

  useEffect(() => {
    const fetchRace = async () => {
      if (races.length === 0) {
        await getRaces();
      }

      const currentRace = races.find((race) => race.uuid === raceUuid);
      if (currentRace) {
        setRace(currentRace);
      }
      setLoading(false);
    };

    fetchRace();
  }, [raceUuid, getRaces, races]);

  useEffect(() => {
    const fetchCategories = async () => {
      setCategoriesLoading(true);
      try {
        const fetchedCategories = await getCategories(raceUuid);
        if (!fetchedCategories.length) {
          await createCategoriesFromRiders(raceUuid);
        }
      } catch (error) {
        console.error("Error fetching or creating categories:", error);
      } finally {
        setCategoriesLoading(false);
      }
    };

    if (!loading && race) {
      fetchCategories();
    }
  }, [loading, race, raceUuid, getCategories, createCategoriesFromRiders]);

  const resolvedImage = useMemo(() => {
    return race
      ? Images[race.image as keyof typeof Images]?.src ||
          Images.defaultRaceBike.src
      : Images.defaultRaceBike.src;
  }, [race]);

  const startCategory = (categoryId: number) => {
    console.log(`Starting category ${categoryId}`);
  };

  if (loading) {
    return <div className={styles.loading}>Loading race...</div>;
  }

  if (!race) {
    console.error("Race not found. UUID:", raceUuid);
    return <div>Race not found.</div>;
  }
  return (
    <div className={styles.race}>
      <div className={styles.top}>
        <div className={styles.headerRaceWrapper}>
          <HeaderRace />
        </div>
        <div className={styles.imageWrapper}>
          <Image
            src={resolvedImage}
            alt="Race image"
            fill
            quality={70}
            className={styles.bannerImage}
          />
        </div>
        <div className={styles.raceInfo}>
          <RaceInfo {...race} />
        </div>
      </div>

      <div className={styles.bottom}>
        <div className={styles.tabs}>
          {["heats", "riders", "categories", "map"].map((tab) => (
            <button
              key={tab}
              className={`${activeTab === tab ? styles.activeTab : ""} ${
                styles.button
              }`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        <div className={styles.tabHeat}>
          {activeTab === "heats" && (
            <Heats
              raceUuid={raceUuid}
              categories={filteredCategories}
              startCategory={startCategory}
            />
          )}
          {activeTab === "riders" && <Riders raceUuid={raceUuid} />}
          {activeTab === "categories" && <Categories raceUuid={raceUuid} />}
          {activeTab === "map" && <Map raceUuid={raceUuid} />}
        </div>
      </div>
    </div>
  );
};

export default Race;
