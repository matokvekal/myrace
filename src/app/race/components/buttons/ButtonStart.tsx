import React from "react";
import PropTypes from "prop-types";
import styles from "./buttonStart.module.css";
import Icons from "@/constants/Icons";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import useRaceStore from "@/stores/racesStore";

const ButtonStart: React.FC<{ category: any }> = ({ category }) => {
  const { updateCategory } = useCategoryStore();
  const { riders, updateAllRiders } = useRiderStore();
  const { races, updateRace } = useRaceStore();

  const startCategory = async () => {
    const now = new Date().toLocaleTimeString();
    // 1. Get race and update its status to "running"
    const race = races.find((race) => race.uuid === category.raceUuid);
    if (race) {
      await updateRace({ ...race, status: "running" });
    }

    // 2. Get category riders
    const categoryRiders = riders.filter(
      (rider) => rider.category === category.name && rider.status !== "DNS"
    );

    // 3. Update category
    const updatedCategory = {
      ...category,
      status: "running",
      startTime: now,
      lapsCounter: 0,
      riders: categoryRiders.length
    };
    await updateCategory(updatedCategory);

    // 4. Update riders
    const updatedRiders = categoryRiders.map((rider, index) => ({
      ...rider,
      raceStatus: "running",
      timeStartRace: now,
      lapsCounter: 0,
      viewOrder: rider.position_start ?? index + 1
    }));

    await updateAllRiders(updatedRiders);
  };

  return (
    <div className={styles.wrapper} onClick={startCategory}>
      <img src={Icons.buttonStart} alt="menu" width={18} height={18} />
      Start
    </div>
  );
};

ButtonStart.propTypes = {
  category: PropTypes.object.isRequired
};

export default ButtonStart;
