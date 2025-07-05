import React from "react";
import styles from "./raceCard.module.css";
import { RaceCardProps } from "@/types/types";
import Images from "@/constants/Images";
import Image from "next/image";
import Icons from "@/constants/Icons";
import { useRouter } from "next/navigation";

const RaceCard: React.FC<RaceCardProps> = ({
  id,
  uuid,
  name,
  time,
  image,
  date,
  status
}) => {
  const router = useRouter();

  const resolvedImage = (() => {
    if (Images[image as keyof typeof Images]?.src) {
      return Images[image as keyof typeof Images].src; // Local image
    } else if (Images[image as keyof typeof Images]?.src) {
      return Images[image as keyof typeof Images].src; // ✅ Local image from Images
    } else {
      return Images.defaultRaceBike.src; // Fallback image
    }
  })();
  const handleClick = () => {
    router.push(`/race/${uuid}`);
  };
  // const resolvedImage =
  //   "https://assets.usacycling.org/prod/assets/_1440xAUTO_crop_center-center_none/540233/Road-Racing.webp";
  return (
    <div key={id} className={styles.raceCard}>
      {/* Optimized Image */}
      <Image
        src={resolvedImage}
        alt={name}
        width={219}
        height={147}
        quality={70}
        className={styles.raceCardImage}
      />
      {status !== "finished" && (
        <div className={styles.managerace} onClick={handleClick}>
          Manage race
          <Image src={Icons.lc} alt="lc" className={styles.lc} />
        </div>
      )}
      <div className={styles.raceCardOverlay}>
        <div className={styles.name}>{name}</div>
        <div className={styles.date}>
          <Image src={Icons.calander} alt="time" width={14} height={14} />{" "}
          {date}
        </div>
        <div className={styles.details}>
          <div className={styles.time}>
            <Image src={Icons.time} alt="time" width={14} height={14} />
            {time}
          </div>
          <div>Heats: {11}</div>
        </div>
      </div>
    </div>
  );
};

export default RaceCard;
