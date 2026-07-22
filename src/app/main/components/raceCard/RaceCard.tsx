import React, { useState } from "react";
import styles from "./raceCard.module.css";
import { RaceCardProps } from "@/types/types";
import { resolveRaceImage } from "@/utils/resolveRaceImage";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  Heart,
  MapPin,
  Trash2,
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
  onToggleFavorite,
  viewOnly,
  onDelete
}) => {
  const navigate = useNavigate();
  // A view-only race deletes in one interaction: tap trash → tap again to
  // confirm (auto-reverts after 3s). No heavy modal — it's disposable (BUGS.md #8).
  const [confirmDelete, setConfirmDelete] = useState(false);

  const resolvedImage = resolveRaceImage(image);

  const statusKey = status ?? "upcoming";

  const handleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleFavorite?.(uuid);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    onDelete?.(uuid);
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
        {viewOnly && onDelete ? (
          <button
            className={`${styles.deleteBtn} ${confirmDelete ? styles.deleteBtnConfirm : ""}`}
            onClick={handleDelete}
            aria-label={confirmDelete ? "tap again to remove" : "remove downloaded race"}
            title={confirmDelete ? "Tap again to remove" : "Remove downloaded race"}
          >
            {confirmDelete ? (
              <span className={styles.deleteConfirmText}>Remove?</span>
            ) : (
              <Trash2 className={styles.favIcon} aria-hidden="true" />
            )}
          </button>
        ) : (
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
        )}
        <ChevronRight className={styles.chevron} aria-hidden="true" />
      </div>
    </div>
  );
};

export default RaceCard;
