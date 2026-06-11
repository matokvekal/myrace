import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Icons from "@/constants/Icons";
import styles from "./headerHeat.module.css";

function HeaderHeat({ raceId }: { raceId: string }) {
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState<string>("");

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const formattedTime = now.toLocaleTimeString("en-GB", { hour12: false });
      setCurrentTime(formattedTime);
    };

    updateClock(); // Initialize immediately
    const interval = setInterval(updateClock, 1000); // Update every second

    return () => clearInterval(interval); // Cleanup on unmount
  }, []);

  const handleBack = () => {
    navigate(`/race/${raceId}`); // Navigate back to the race page
  };

  return (
    <div className={styles.headerRace}>
      <div className={styles.left} onClick={handleBack}>
        <img src={Icons.arrowBackBlack} alt="back" width={14} height={14} />
      </div>
      <div>Manage heat</div>
      <div className={styles.time}>{currentTime}</div>
      <div className={styles.menu}>
        <img src={Icons.threedotsBlack} alt="menu" width={20} height={20} />
      </div>
    </div>
  );
}

export default HeaderHeat;
