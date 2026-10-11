import React from "react";
import styles from "./standingCard.module.css";
import { RiderProps } from "@/types/types";
import Icons from "@/constants/Icons";
import Images from "@/constants/Images";
import useRiderStore from "@/stores/ridersStore";
import useUIStore from "@/stores/uiStore";
import RiderFlag from "../riderFlag/RiderFlag";

interface StandingCardProps {
  rider: RiderProps;
  setSelectedRider: React.Dispatch<React.SetStateAction<RiderProps | null>>;
  markStanding: (rider: RiderProps) => Promise<void>;
}

const StandingCard: React.FC<StandingCardProps> = ({
  rider,
  setSelectedRider,
  markStanding
}) => {
  // Subscribe to updateRider and getRiders for UI refresh
  const openModal = useUIStore((state) => state.openModal);

  // Open modal to manually change status
  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedRider(rider);
    openModal("modalStatus");
  };

  return (
    <div className={styles.card}>
      <div className={styles.left}>
        <div className={styles.imageWrapper}>
          <img className={styles.imageRider} src={Images.user} alt="" width={36} height={36} />
          <RiderFlag flag={rider.flag} className={styles.imageFlag} />
        </div>
      </div>

      {/* Middle area: click to mark standing */}
      <div className={styles.middle} onClick={() => markStanding(rider)}>
        <div className={styles.middleLeft}>
          <div className={styles.middleTop}>
            <div
              className={styles.name}
            >{`${rider.lastName} ${rider.firstName}`}</div>
            <div className={styles.linespace}>|</div>
            <div className={styles.number}>{rider.bibNumber}</div>
          </div>
          <div className={styles.middleBottom}>
            <div className={styles.laps}>Laps: {rider.totalLaps}</div>
            <div className={styles.category}>{rider.category}</div>
            <div
              className={styles.point}
              style={{ background: rider.color || "lightgray" }}
            />
            <div className={styles.pos}>Start Pos: {rider.position_start}</div>
          </div>
        </div>

        {/* Plus icon also marks standing */}
        <div className={styles.middleRight}>
          <img className={styles.editdark} src={Icons.plusBlue} alt="Mark Standing" width={14} height={14} onClick={() => markStanding(rider)} />
        </div>
      </div>

      <div className={styles.right}>
        {/* Edit status */}
        <img className={styles.editdark} src={Icons.editdark} alt="Edit Status" width={14} height={14} onClick={handleEditClick} />

        {rider.status === "standing" && (
          <img src={Icons.blueV} alt="Standing" width={14} height={14} className={styles.blueV} />
        )}

        {/* DNS/DSQ indicators */}
        {rider.status === "DNS" && <div className={styles.dns}>DNS</div>}
        {rider.status === "DSQ" && <div className={styles.dsq}>DSQ</div>}
      </div>
    </div>
  );
};

export default StandingCard;
