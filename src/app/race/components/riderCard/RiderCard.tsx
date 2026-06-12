import React from "react";
import { RiderProps } from "@/types/types";
import styles from "./riderCard.module.css";
import Icons from "@/constants/Icons";
import Images from "@/constants/Images";

const RiderCard: React.FC<RiderProps> = (rider) => {
  return (
    <div className={styles.riderCard}>
      <div className={styles.left}>
        <div className={styles.imageWrapper}>
          <img
            className={styles.imageRider}
            src={Images.user}
            alt="Rider Image"
            width={36}
            height={36}
          />
          <img
            className={styles.imageFlag}
            src={Icons.flag_us}
            alt="Rider Image"
            width={14}
            height={14}
          />
        </div>
      </div>
      <div className={styles.middle}>
        <div className={styles.middleTop}>
          <div className={styles.name}>
            {`${rider.lastName}   ${rider.firstName}`}
          </div>
          <div className={styles.linespace}>|</div>
          <div className={styles.number}> {rider.bibNumber}</div>
        </div>
        <div className={styles.middleCenter}>
          <div className={styles.raceStatus}>Heat {rider.heat}</div>
          <div
            className={styles.point}
            style={{ background: `${rider.color || "lightgray"}` }}
          ></div>
          <div className={styles.category}>
            {rider.category}
            {rider.subCategory && (
              <span className={styles.subCategory}> · {rider.subCategory}</span>
            )}
          </div>
        </div>
        <div className={styles.middleBottom}>
          <div className={styles.laps}>
            {`Laps:${rider.lapsCounter}/${rider.totalLaps}`}
          </div>
          <div className={styles.point}></div>
          <div className={styles.time}>
            {`Time:${rider.elapsedTimeFromStart}`}
          </div>
        </div>
      </div>
      <div className={styles.right}>
        <div className={`${styles.riderStatus} ${styles.finishcolor}`}>
          {rider.raceStatus}
        </div>
        <div className={styles.pos}>
          {/* {rider.raceStatus === "running" ? "Pos:" : "Final Pos:"} {rider.position_category || rider.position_start}</div> */}
          {/* Pos: {rider.position_category || rider.position_start} */}

          {rider.raceStatus === "upcoming"
            ? `Stand:${rider.position_start}`
            : `Pos:${rider.position_category}`}
        </div>
      </div>
    </div>
  );
};
export default RiderCard;
