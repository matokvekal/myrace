import React from "react";
import styles from "./raceCard.module.css";
import { RaceCardProps } from "@/types/types";
import Images from "@/constants/Images";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  Heart,
  MapPin,
  Users
} from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  running: "Live",
  upcoming: "Upcoming",
  finished: "Finished"
};

const RaceCard: React.FC<RaceCardProps> = ({
  uuid,
  name,
  time,
  image,
  date,
  status,
  location,
  ridersCount,
  isFavorite,
  onToggleFavorite
}) => {
  const navigate = useNavigate();

  const resolvedImage =
    image?.startsWith("data:") ||
    image?.startsWith("/") ||
    image?.startsWith("http")
      ? image
      : (Images[image as keyof typeof Images] ?? Images.defaultRaceBike);

  const statusKey = status ?? "upcoming";

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite?.(uuid);
  };

  return (
    <div
      className={`${styles.card} ${styles[statusKey]}`}
      onClick={() => navigate(`/race/${uuid}`)}
    >
      <div className={styles.accent} />

      <div className={styles.thumb}>
        <img src={resolvedImage} alt={name} className={styles.thumbImg} />
      </div>

      <div className={styles.body}>
        <div className={styles.topRow}>
          <span className={styles.name}>{name}</span>
          <span className={`${styles.badge} ${styles[`badge_${statusKey}`]}`}>
            {status === "running" && <span className={styles.dot} />}
            {STATUS_LABEL[statusKey]}
          </span>
        </div>

        <div className={styles.meta}>
          {date && (
            <span className={styles.metaItem}>
              <CalendarDays className={styles.metaIcon} aria-hidden="true" />
              {date}
            </span>
          )}
          {time && (
            <span className={styles.metaItem}>
              <Clock3 className={styles.metaIcon} aria-hidden="true" />
              {time}
            </span>
          )}
          {location && (
            <span className={styles.metaItem}>
              <MapPin className={styles.metaIcon} aria-hidden="true" />
              {location}
            </span>
          )}
          {ridersCount > 0 && (
            <span className={styles.metaItem}>
              <Users className={styles.metaIcon} aria-hidden="true" />
              {ridersCount}
            </span>
          )}
        </div>
      </div>

      <div className={styles.right}>
        <button
          className={`${styles.favBtn} ${isFavorite ? styles.favBtnActive : ""}`}
          onClick={handleFavorite}
          aria-label="favorite"
        >
          <Heart
            className={styles.favIcon}
            aria-hidden="true"
            fill={isFavorite ? "currentColor" : "none"}
          />
        </button>
        <ChevronRight className={styles.chevron} aria-hidden="true" />
      </div>
    </div>
  );
};

export default RaceCard;
