import React from "react";
import styles from "./headerRace.module.css";
import Icons from "@/constants/Icons";
import { useNavigate } from "react-router-dom";
import useUIStore from "@/stores/uiStore";

function HeaderRace() {
  const navigate = useNavigate();
  const isRaceMode = useUIStore((s) => s.isRaceMode);
  const setRaceMode = useUIStore((s) => s.setRaceMode);

  return (
    <div className={`${styles.headerRace} ${isRaceMode ? styles.raceModeActive : ""}`}>
      <div className={styles.left}>
        {isRaceMode ? (
          <button className={styles.exitBtn} onClick={() => setRaceMode(false)}>
            ✕ Exit
          </button>
        ) : (
          <img src={Icons.arrowLeft} alt="back" width={34} height={34} onClick={() => navigate("/main")} style={{ cursor: "pointer" }} />
        )}
      </div>

      <div className={styles.center}>
        {isRaceMode && <span className={styles.raceModeLabel}>🏁 RACE MODE</span>}
      </div>

      <div className={styles.right}>
        {!isRaceMode && (
          <img src={Icons.threeDots} alt="menu" width={34} height={34} />
        )}
        <button
          className={`${styles.raceModeBtn} ${isRaceMode ? styles.raceModeBtnActive : ""}`}
          onClick={() => setRaceMode(!isRaceMode)}
        >
          {isRaceMode ? "View" : "🏁 Race Mode"}
        </button>
      </div>
    </div>
  );
}

export default HeaderRace;
