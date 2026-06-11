import React from "react";
import styles from "./raceCard.module.css";
import { RaceCardProps } from "@/types/types";
import Images from "@/constants/Images";
import Icons from "@/constants/Icons";
import { useNavigate } from "react-router-dom";

const STATUS_LABEL: Record<string, string> = {
  running: "Live",
  upcoming: "Upcoming",
  finished: "Finished",
};

const COUNTRY_FLAGS: Record<string, string> = {
  israel: "🇮🇱", france: "🇫🇷", italy: "🇮🇹", spain: "🇪🇸",
  belgium: "🇧🇪", netherlands: "🇳🇱", usa: "🇺🇸", "united states": "🇺🇸",
  uk: "🇬🇧", germany: "🇩🇪", australia: "🇦🇺", canada: "🇨🇦",
  switzerland: "🇨🇭", austria: "🇦🇹", portugal: "🇵🇹",
};

const getFlag = (location: string): string | null => {
  const lower = location.toLowerCase();
  for (const [key, flag] of Object.entries(COUNTRY_FLAGS)) {
    if (lower.includes(key)) return flag;
  }
  return null;
};

const RaceCard: React.FC<RaceCardProps> = ({
  uuid, name, time, image, date, status, location, ridersCount, isFavorite, onToggleFavorite,
}) => {
  const navigate = useNavigate();

  const resolvedImage =
    image?.startsWith("data:") || image?.startsWith("/") || image?.startsWith("http")
      ? image
      : (Images[image as keyof typeof Images] ?? Images.defaultRaceBike);

  const statusKey = status ?? "upcoming";
  const flag = getFlag(location ?? "");

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite?.(uuid);
  };

  return (
    <div className={styles.card} onClick={() => navigate(`/race/${uuid}`)}>
      <div className={styles.thumb}>
        <img src={resolvedImage} alt={name} className={styles.thumbImg} />
        {status === "running" && <span className={styles.liveDot} />}
      </div>

      <div className={styles.info}>
        <div className={styles.nameRow}>
          <span className={styles.name}>{name}</span>
          <span className={`${styles.badge} ${styles[statusKey]}`}>
            {STATUS_LABEL[statusKey]}
          </span>
        </div>

        <div className={styles.metaRow}>
          <span className={styles.metaItem}>
            <img src={Icons.calander} alt="" width={11} height={11} />
            {date}
          </span>
          <span className={styles.metaItem}>
            <img src={Icons.time} alt="" width={11} height={11} />
            {time}
          </span>
        </div>

        <div className={styles.metaRow}>
          {location ? (
            <span className={styles.metaItem}>
              <img src={Icons.earth} alt="" width={11} height={11} />
              <span className={styles.locationText}>{location}</span>
              {flag && <span className={styles.flag}>{flag}</span>}
            </span>
          ) : null}
          {ridersCount > 0 && (
            <span className={styles.metaItem}>
              <img src={Icons.rider1} alt="" width={11} height={11} />
              {ridersCount}
            </span>
          )}
        </div>
      </div>

      <div className={styles.actions}>
        <button className={styles.heartBtn} onClick={handleFavorite}>
          <span className={isFavorite ? styles.heartFilled : styles.heartEmpty}>
            {isFavorite ? "♥" : "♡"}
          </span>
        </button>
        {status !== "finished" && (
          <img src={Icons.arrowback} alt="" className={styles.arrow} />
        )}
      </div>
    </div>
  );
};

export default RaceCard;
