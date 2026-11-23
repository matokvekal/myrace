import React from "react";
import { Star } from "lucide-react";
import { useMyRidersContext } from "./myRiders";
import styles from "./myRiders.module.css";

/** Star button: follow a rider (My riders). Stops the click so the row behind it does not open. */
export function StarButton({ uuid, name }: { uuid: string | undefined; name: string }) {
  const my = useMyRidersContext();
  if (!uuid) return null;
  const on = my.has(uuid);
  return (
    <button
      type="button"
      className={styles.star}
      data-on={on ? "true" : undefined}
      aria-pressed={on}
      aria-label={on ? `Stop following ${name}` : `Follow ${name}`}
      title={on ? "Remove from My riders" : "Add to My riders"}
      onClick={(e) => {
        e.stopPropagation();
        my.toggle(uuid);
      }}
      data-testid="share-star"
    >
      <Star size={16} aria-hidden="true" fill={on ? "currentColor" : "none"} />
    </button>
  );
}
