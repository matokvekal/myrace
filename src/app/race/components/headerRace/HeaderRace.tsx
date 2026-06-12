import React from "react";
import styles from "./headerRace.module.css";
import Button from "@/components/ui/Button";
import { useNavigate } from "react-router-dom";
import useUIStore from "@/stores/uiStore";
import { ArrowLeft, Flag, MoreHorizontal, X } from "lucide-react";

function HeaderRace() {
  const navigate = useNavigate();
  const isRaceMode = useUIStore((s) => s.isRaceMode);
  const setRaceMode = useUIStore((s) => s.setRaceMode);

  return (
    <div
      className={`${styles.headerRace} ${isRaceMode ? styles.raceModeActive : ""}`}
    >
      <div className={styles.left}>
        {isRaceMode ? (
          <Button
            variant="secondary"
            size="sm"
            className={styles.exitBtn}
            onClick={() => setRaceMode(false)}
          >
            <X size={14} />
            Exit
          </Button>
        ) : (
          <Button
            variant="icon"
            size="md"
            iconOnly
            aria-label="Back to main"
            onClick={() => navigate("/main")}
            className={styles.backBtn}
          >
            <ArrowLeft size={18} />
          </Button>
        )}
      </div>

      <div className={styles.center}>
        {isRaceMode && (
          <span className={styles.raceModeLabel}>
            <Flag size={14} />
            Race Mode
          </span>
        )}
      </div>

      <div className={styles.right}>
        {!isRaceMode && (
          <Button
            variant="icon"
            size="md"
            iconOnly
            aria-label="Race menu"
            className={styles.menuBtn}
          >
            <MoreHorizontal size={16} />
          </Button>
        )}
        <Button
          variant={isRaceMode ? "secondary" : "success"}
          size="sm"
          className={`${styles.raceModeBtn} ${isRaceMode ? styles.raceModeBtnActive : ""}`}
          onClick={() => setRaceMode(!isRaceMode)}
        >
          {isRaceMode ? "View" : "Race Mode"}
        </Button>
      </div>
    </div>
  );
}

export default HeaderRace;
