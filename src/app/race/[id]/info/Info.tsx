import React from "react";
import styles from "./info.module.css";
import { RaceProps } from "@/types/types";
import Icons from "@/constants/Icons";

interface Props {
  race: RaceProps;
}

const Info: React.FC<Props> = ({ race }) => {
  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Race Details</div>
        <Row icon={Icons.calander} label="Date" value={race.date} />
        <Row icon={Icons.time} label="Start time" value={race.time} />
        <Row icon={Icons.earth} label="Location" value={race.location} />
        <Row icon={Icons.road} label="Distance" value={race.distance ? `${race.distance} km` : "—"} />
        <Row icon={Icons.setting} label="Type" value={race.type} />
        <Row icon={Icons.setting} label="Level" value={race.level} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Organisation</div>
        <Row icon={Icons.rider1} label="Organiser" value={race.orgenizer} />
        <Row icon={Icons.rider1} label="Manager" value={race.manager} />
        <Row icon={Icons.mainMsg} label="Phone" value={race.phone} />
        {race.site && <Row icon={Icons.earth} label="Website" value={race.site} />}
      </div>

      {race.takanon && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Rules</div>
          <div className={styles.rulesText}>{race.takanon}</div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Status</div>
        <div className={`${styles.statusBadge} ${styles[race.status ?? "upcoming"]}`}>
          {race.status ?? "upcoming"}
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ icon: string; label: string; value: string }> = ({ icon, label, value }) => (
  <div className={styles.row}>
    <img src={icon} alt="" width={16} height={16} className={styles.rowIcon} />
    <span className={styles.rowLabel}>{label}</span>
    <span className={styles.rowValue}>{value || "—"}</span>
  </div>
);

export default Info;
