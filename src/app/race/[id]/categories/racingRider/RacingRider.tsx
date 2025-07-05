import React from "react";
import styles from "./racingRider.module.css";
import { RiderProps } from "@/types/types";

interface GRacingRiderProps {
  rider: RiderProps;
  onClick: () => void;
}
const RacingRider: React.FC<GRacingRiderProps> = ({ rider, onClick }) => {
  return (
    <div
      className={styles.rider}
      onClick={onClick}
      style={{ background: rider.color || "lightgray" }}
    >
      <div className={styles.bib}>{rider.bibNumber}</div>
      <div className={styles.time}>Pos:{rider.position_category}</div>
      <div className={styles.time}>{rider.elapsedLastLap}</div>
      <div className={styles.lap}>
        {" "}
        {rider.totalLaps - rider.lapsCounter} Laps
      </div>
      - {rider.viewOrder}
    </div>
  );
};

export default RacingRider;

// import React from "react";
// import PropTypes from "prop-types";
// import styles from "./gridRider.module.css";
// import Image from "next/image";
// import Icons from "@/constants/Icons";

// const GridRider = () => {
// return (
// <div className={styles.rider}>

//     <div className={styles.bib}>975</div>
//     <div className={styles.time}>00:08:12</div>
//     <div className={styles.lap}>1/2</div>
// </div>
// );
// };

// export default GridRider;
