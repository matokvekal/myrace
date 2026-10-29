import React, { useEffect, useState } from "react";
import styles from "./jokerCard.module.css";
import { Bike } from "lucide-react";
import { formatTime } from "@/utils/timeUtils";
import type { JokerEntry } from "../useJokerQueue";

interface Props {
  joker: JokerEntry;
  onClick: () => void;
}

const JokerCard: React.FC<Props> = ({ joker, onClick }) => {
  const capturedAtMs = new Date(joker.capturedAt).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const sinceCaptured = formatTime((now - capturedAtMs) / 1000);
  // The passage time as recorded (HH:mm); the full timestamp stays in capturedAt.
  const passedAt = new Date(capturedAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div
      data-testid={`joker-card-${joker.sequence}`}
      className={styles.joker}
      onClick={onClick}
      title="Unknown Rider: tap to assign the bib (the original passage time is kept)"
    >
      <Bike className={styles.bikeIcon} aria-hidden="true" />
      <div className={styles.unknown}>? Unknown Rider</div>
      <div className={styles.sequence}>
        #{joker.sequence} · <time dateTime={joker.capturedAt}>{passedAt}</time>
      </div>
      <div className={styles.since}>{sinceCaptured}</div>
    </div>
  );
};

export default JokerCard;
