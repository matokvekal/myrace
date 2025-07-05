import React from "react";
import PropTypes from "prop-types";
import styles from "./finishRider.module.css";
import Image from "next/image";
import Icons from "@/constants/Icons";
import { RiderProps } from "@/types/types";

interface GRacingRiderProps {
  rider: RiderProps;
  onClick: () => void;
}
const FinishRider: React.FC<GRacingRiderProps> = ({ rider, onClick }) => {
  return (
    <div
      className={styles.rider}
      style={{ borderColor: rider.color || "lightgray" }}
    >
      <div className={styles.bib}>{rider.bibNumber}</div>
      <div className={styles.time}>Pos:{rider.position_category}</div>
      <div className={styles.time}>{rider.elapsedLastLap}</div>
      {/* <div className={styles.lap}>{rider.totalLaps - rider.lapsCounter}</div> */}
    </div>
  );
};

export default FinishRider;
