import React, { useState, useEffect } from "react";
import styles from "./buttonRunning.module.css";
import { startTimer } from "@/utils/timeUtils";

const ButtonActive: React.FC<{ category: any }> = ({ category }) => {
  const [elapsedTime, setElapsedTime] = useState<string>("00:00:00");

  useEffect(() => {
    if (category?.startTime) {
      const stopTimer = startTimer(category.startTime, setElapsedTime);
      // Cleanup on unmount
      return () => stopTimer();
    }
  }, [category?.startTime]);

  return <div className={styles.wrapper}>{elapsedTime}</div>;
};

export default ButtonActive;
