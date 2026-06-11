import React from "react";
import PropTypes from "prop-types";
import styles from "./raceInfo.module.css";
import Icons from "@/constants/Icons";
import ButtonActive from "../buttons/ButtonRunning";
import {RaceProps} from "@/types/types";
//bring race interface from types 

const HeaderRace: React.FC<RaceProps> = ({name, date, image, time, status}) => {
const category = "TEST CATEGORY";

  return (
    <div className={styles.raceInfo}>
      <div className={`${styles.row} ${styles.header}`}>
        <div>{name}</div>
        <ButtonActive category={category} />
      </div>
      <div className={styles.row}>Details</div>

      <div className={styles.row}>
        <div className={styles.left}>
          <img src={Icons.date} alt="menu" width={14} height={14} />
          <div className={styles.rowData}>{date}</div>
        </div>
        <div className={styles.right}>
          <img src={Icons.earth} alt="menu" width={14} height={14} />
          <div className={styles.rowData}>israel </div>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.left}>
          <img src={Icons.road} alt="menu" width={14} height={14} />
          <div className={styles.rowData}>flat</div>
        </div>
        <div className={styles.right}>
          <img src={Icons.bike} alt="menu" width={14} height={14} />
          <div className={styles.rowData}>102</div>
        </div>
      </div>
      <div className={`${styles.row} ${styles.bottom}`}>
        <div className={styles.left}>
          <div className={styles.rowHead}>Race manager</div>
        </div>
        <div className={styles.right}>
          <div className={styles.rowHead}>Racing terms</div>
        </div>
      </div>
      <div className={styles.row}>
        <div className={styles.left}>
          <img src={Icons.rider1} alt="menu" width={14} height={14} />
          <div className={styles.rowData}>dan peled</div>
        </div>
        <div className={styles.right}>
          <img src={Icons.calander} alt="menu" width={14} height={14} />
          <div className={styles.rowData}>GFNY terms</div>
        </div>
      </div>
    </div>
  );
}

export default HeaderRace;
