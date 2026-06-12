import React, { useEffect, useState } from "react";
import RaceCard from "../components/raceCard/RaceCard";
import styles from "./myRaces.module.css";
import Icons from "@/constants/Icons";
import useRaceStore from "@/stores/racesStore";
import { RaceProps } from "@/types/types"; // Import the RaceProps type

interface props {
  setAddNewwRace: (value: boolean) => void;
}

const MyRaces: React.FC<props> = ({ setAddNewwRace }) => {
  const { getRaces } = useRaceStore();
  const [races, setRaces] = useState<RaceProps[]>([]); // Explicitly type the races state

  useEffect(() => {
    const fetchRaces = async () => {
      const fetchedRaces = await getRaces(); // Fetch races from the store
      setRaces(fetchedRaces); // Update local state with the correct type
    };

    fetchRaces();
  }, [getRaces]);

  const handleNewRace = () => {
    setAddNewwRace(true);
  };
  return (
    <div className={styles.myRacesContainer}>
      <div className={styles.myRacesHeader}>
        <div className={styles.left}>My races ({races.length})</div>
        <div className={styles.right} onClick={handleNewRace}>
          <img src={Icons.plus} alt="plus" width={16} height={16} />
        </div>
      </div>
      <div className={styles.cards}>
        {races?.length > 0 &&
          races
            .sort((a, b) => b.id - a.id)
            .map((race) => (
              // {races.map((race) => (
              <RaceCard
                key={race.uuid}
                id={race.id}
                uuid={race.uuid}
                name={race.name}
                time={race.time}
                date={race.date}
                image={race.image}
                status={race.status}
                location={race.location ?? ""}
                ridersCount={0}
                curentHeat={null}
              />
            ))}
      </div>
    </div>
  );
};

export default MyRaces;
