import React from "react";
import styles from "./EmptyRaces.module.css";
import Icons from "@/constants/Icons";
import Button from "@/components/ui/Button";

interface EmptyRacesProps {
  onCreateRace: () => void;
}

const EmptyRaces: React.FC<EmptyRacesProps> = ({ onCreateRace }) => {
  return (
    <div className={styles.wrapper}>
      <div className={styles.iconCircle}>
        <img src={Icons.bike} alt="bike" />
      </div>

      <div className={styles.title}>No races yet</div>
      <div className={styles.subtitle}>
        Create your first race or import one from the server when you're ready.
      </div>

      <div className={styles.actions}>
        <Button
          variant="success"
          size="lg"
          className={styles.btnPrimary}
          onClick={onCreateRace}
        >
          <img src={Icons.plus} alt="" />
          Create new race
        </Button>

        <div className={styles.divider}>or</div>

        <Button
          variant="secondary"
          size="lg"
          className={styles.btnSecondary}
          disabled
        >
          <img src={Icons.mainMsg} alt="" />
          Browse server races
          <span className={styles.soon}>Soon</span>
        </Button>
      </div>
    </div>
  );
};

export default EmptyRaces;
