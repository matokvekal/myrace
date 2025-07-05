import React, { useState, useEffect } from "react";
import styles from "./circleChart.module.css";
import { convertMinutesToHHMM } from "@/utils/timeUtils";

interface CircleChartProps {
  usedTimeDegree: number;
  totalHours: number;
  id: number;
}

const CircleChart: React.FC<CircleChartProps> = ({
  usedTimeDegree,
  totalHours,
  id,
}) => {
  const [progressStyle, setProgressStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    setProgressStyle({
      background: `conic-gradient(
        var(--primary-green) 0deg ${usedTimeDegree}deg,
        transparent ${usedTimeDegree}deg 360deg
      )`,
    });
  }, [usedTimeDegree]);

  return (
    <div className={styles.outerCircle}>
      <div className={styles.progress} style={progressStyle}></div>
      <div className={styles.innerCircle}>
        <div className={styles.totalHours}>
          {convertMinutesToHHMM(totalHours)}
        </div>
      </div>
    </div>
  );
};

export default CircleChart;
