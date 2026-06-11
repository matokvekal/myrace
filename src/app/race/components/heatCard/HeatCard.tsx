import React, { useState } from "react";
import styles from "./heatCard.module.css";
import ButtonStart from "../buttons/ButtonStart";
import ButtonRunning from "../buttons/ButtonRunning";
import { useNavigate } from "react-router-dom";
import Icons from "@/constants/Icons";

const HeatCard = ({ category, prevHeat, nextHeat, raceId }: any) => {
  // const [isPaused, setIsPaused] = useState(false);
  const navigate = useNavigate();
  const manageHeat = () => {
    navigate(`/race/${raceId}/heat/${category.heat}`);
  };
  const manageStanding = () => {
    navigate(
      `/race/${raceId}/standing/${category.heat}?category=${encodeURIComponent(
        category.name
      )}`
    );
  };

  const totalLaps = category.laps;
  const completedLaps = category.lapsCounter;

  const positionInHeat =
    prevHeat === null || prevHeat !== category.heat
      ? nextHeat === category.heat
        ? "first"
        : "one"
      : nextHeat === category.heat
      ? "middle"
      : "last";
  const showHeat = positionInHeat === "first" || positionInHeat === "one";

  const heatClass = `heat_${category.heat}`;
  const heatBorder = `border_${category.heat}`;

  const renderLapProgress = () => {
    const lapSections = [];
    for (let i = 1; i <= totalLaps; i++) {
      lapSections.push(
        <div
          key={i}
          className={`${styles.lapSection} ${
            i <= completedLaps ? styles.completedLap : ""
          }`}
        ></div>
      );
    }
    return lapSections;
  };
  return (
    <div className={`${styles.heatWrapper} ${styles[positionInHeat]} `}>
      {showHeat && (
        <div className={`${styles.heat} ${styles[heatClass]} `}>
          <div>Heat {category.heat}</div>

          {/* <div className={styles.standing} onClick={manageStanding}>
            Standing
          </div> */}
          <div className={styles.manage} onClick={manageHeat}>
            Manage heat
          </div>
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.head}>
          <div className={styles.left}>
            <div className={styles.leftTop}>
              <div
                className={styles.stageColor}
                style={{ background: `${category.color || "lightgray"}` }}
              ></div>
              <div className={styles.categoryName}> {category.name}</div>
              <div className={styles.dot}></div>
              <div className={styles.participents}>
                <img src={Icons.bike} alt="bike" width={16} height={16} className={styles.icon} />

                {category.riders}
              </div>
            </div>
            <div className={styles.leftBottom}>
              <div className={styles.laps}>
                {category.lapsCounter || 0}/{category.laps || 0} Laps
              </div>
              <div className={styles.dot}></div>
              <div className={styles.start}>
                {category.startTime || "upcoming"}
              </div>
            </div>
          </div>
          <div className={styles.middle}>
            <div className={styles.standing} onClick={manageStanding}>
              Standing
            </div>
          </div>
          <div className={styles.button}>
            {category.status === "upcoming" && (
              <ButtonStart category={category} />
            )}

            {category.status === "running" && (
              <ButtonRunning category={category} />
            )}
          </div>
        </div>
        <div className={styles.footer}>{renderLapProgress()}</div>
      </div>
    </div>
  );
};

export default HeatCard;
//when ckick at start we update the viewOrder of thos category riders and we give time to start race category, we start counting time
//and we will show only categories that started
