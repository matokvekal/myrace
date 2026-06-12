import React from "react";
import PropTypes from "prop-types";
import styles from "./buttonStart.module.css";
import Button from "@/components/ui/Button";
import { Play } from "lucide-react";
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
      raceStatus: "running" as const,
      timeStartRace: now,
      lapsCounter: 0,
      viewOrder: rider.position_start ?? index + 1
    }));

    await updateAllRiders(updatedRiders);
  };

  return (
    <Button
      className={styles.wrapper}
      variant="primary"
      size="sm"
      onClick={startCategory}
    >
      <Play size={12} />
      Start
    </Button>
  );
};

ButtonStart.propTypes = {
  category: PropTypes.object.isRequired
};

export default ButtonStart;
