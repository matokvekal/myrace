import React, { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import styles from "./bibWarning.module.css";
import type { CategoryProps, RiderProps } from "@/types/types";
import { getUpcomingBibWarnings } from "@/utils/bibIssues";

interface Props {
  raceUuid: string;
  categories: CategoryProps[];
  riders: RiderProps[];
  /** When provided, each category row is tappable and opens it for fixing (Check-In). */
  onFix?: (category: CategoryProps) => void;
}

/**
 * Early warning for categories that Start will refuse (missing / duplicate
 * bibs). Shown on the Race and Live screens so the organizer finds out when
 * they arrive, not when they press Start with the riders on the line.
 * Renders nothing when every upcoming category is clean.
 */
const BibWarning: React.FC<Props> = ({ raceUuid, categories, riders, onFix }) => {
  const [open, setOpen] = useState(false);
  const warnings = useMemo(
    () => getUpcomingBibWarnings(categories, riders, raceUuid),
    [categories, riders, raceUuid]
  );
  if (warnings.length === 0) return null;

  return (
    <div className={styles.banner} role="alert" data-testid="bib-warning">
      <button type="button" className={styles.head} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <AlertTriangle size={16} className={styles.icon} />
        <span className={styles.title}>
          Bib problems in {warnings.length} categor{warnings.length > 1 ? "ies" : "y"} — they can't start until fixed
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <ul className={styles.list}>
          {warnings.map(({ category, issues }) => (
            <li key={category.id}>
              <button
                type="button"
                className={styles.row}
                disabled={!onFix}
                onClick={() => onFix?.(category)}
                data-testid={`bib-warning-${category.id}`}
              >
                <span className={styles.dot} style={{ background: category.color ?? "#ccc" }} />
                <span className={styles.catName} dir="auto">{category.name}</span>
                <span className={styles.detail}>
                  {issues.noBib > 0 && <span>{issues.noBib} without bib</span>}
                  {issues.dupBib > 0 && <span>duplicate bib {issues.dupBibs.join(", ")}</span>}
                </span>
                {onFix && <span className={styles.fix}>Fix ›</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default BibWarning;
