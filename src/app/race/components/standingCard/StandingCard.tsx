import React from "react";
import styles from "./standingCard.module.css";
import { RiderProps } from "@/types/types";
import Image from "next/image";
import Icons from "@/constants/Icons";
import Images from "@/constants/Images";
import useRiderStore from "@/stores/ridersStore";
import useUIStore from "@/stores/uiStore";

interface StandingCardProps {
  rider: RiderProps;
  setSelectedRider: React.Dispatch<React.SetStateAction<RiderProps | null>>;
}
const StandingCard: React.FC<StandingCardProps> = ({
  setSelectedRider,
  rider
}) => {
  const { updateRider } = useRiderStore();
  const openModal = useUIStore((state) => state.openModal);
  const handleStanding = async () => {
    if (!rider.status) {
      const updatedRider = {
        ...rider,
        status: "standing" as RiderProps["status"]
      };
      await updateRider(updatedRider);
    }
  };

  const handleEditClick = (
    e: React.MouseEvent<HTMLImageElement, MouseEvent>
  ) => {
    e.stopPropagation();
    setSelectedRider(rider);

    openModal("modalStatus");
  };
  return (
    <>
      <div className={styles.card}>
        <div className={styles.left}>
          <div className={styles.imageWrapper}>
            <Image
              className={styles.imageRider}
              src={Images.user}
              alt="Rider Image"
              width={36}
              height={36}
            />
            <Image
              className={styles.imageFlag}
              src={Icons.flag_us}
              alt="Rider Image"
              width={14}
              height={14}
            />
          </div>
        </div>
        <div className={styles.middle} onClick={() => handleStanding()}>
          <div className={styles.middleTop}>
            <div className={styles.name}>
              {`${rider.lastName}   ${rider.firstName}`}
            </div>
            <div className={styles.linespace}>|</div>
            <div className={styles.number}> {rider.bibNumber}</div>
          </div>

          <div className={styles.middleBottom}>
            <div className={styles.laps}>{`Laps:${rider.totalLaps}`}</div>
            <div className={styles.category}>{rider.category}</div>
            <div
              className={styles.point}
              style={{ background: `${rider.color || "lightgray"}` }}
            ></div>
            <div className={styles.pos}>Stand:{rider.position_start}</div>
          </div>
        </div>
        <div className={styles.right}>
          <Image
            className={styles.editdark}
            src={Icons.editdark}
            alt="edit"
            width={14}
            height={14}
            onClick={(e) => handleEditClick(e)}
          />

          <Image
            src={Icons.blueV}
            alt="v"
            width={14}
            height={14}
            className={` ${
              rider.status === "standing" ? styles.blueV : styles.hide
            }`}
          />
          {rider.status === "DNS" && <div className={styles.dns}> DNS</div>}
          {rider.status === "DSQ" && <div className={styles.dsq}> DSQ</div>}
        </div>
      </div>
    </>
  );
};

export default StandingCard;
