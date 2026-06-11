import React from "react";
import styles from "./heat.module.css";
import HeatCard from "../../components/heatCard/HeatCard";

interface HeatsProps {
  raceUuid: string;
  categories: Array<any>; // Replace `any` with a proper type if available
  startCategory: (categoryId: number) => void;
}
const Heats: React.FC<HeatsProps> = ({
  raceUuid,
  categories,
  startCategory
}) => {
  const uniqueHeats = new Set(categories.map((category) => category.heat)).size;
  return (
    <div className={styles.heats}>
      <div className={styles.tabCount}> Heats({uniqueHeats})</div>
      {categories?.length > 0 &&
        [...categories]
          .sort((a, b) => a.heat - b.heat)
          .map((category, index, arr) => {
            const prevHeat = index > 0 ? arr[index - 1].heat : null;
            const nextHeat =
              index < arr.length - 1 ? arr[index + 1].heat : null;

            return (
              <HeatCard
                key={category.id}
                category={category}
                raceId={raceUuid}
                prevHeat={prevHeat}
                nextHeat={nextHeat}
                onStart={() => startCategory(category.id)}
              />
            );
          })}
    </div>
  );
};

export default Heats;
