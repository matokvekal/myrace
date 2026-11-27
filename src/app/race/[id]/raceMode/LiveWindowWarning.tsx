import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { CategoryProps } from "@/types/types";
import { unfinishedAfterWindow } from "../../../../shared/race/guestPolling";
import styles from "../../components/bibWarning/bibWarning.module.css";

interface Props {
  race: { status?: string | null; date?: string | null; time?: string | null; createdAt?: string | null; endDate?: string | null; finalized?: unknown } | undefined;
  categories: CategoryProps[];
  /** Tapping the warning opens Live of the first unfinished wave (where Finish Wave is). */
  onOpenWave?: (wave: number) => void;
}

/**
 * For the organizer: the 24 h LIVE window (shared/race/guestPolling.ts) is over but a wave is
 * still running. Spectators already see it as NOT FINISHED and live updates have stopped; the
 * data is untouched — finishing the wave is the organizer's decision, never automatic.
 */
const LiveWindowWarning: React.FC<Props> = ({ race, categories, onOpenWave }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  if (!race || race.finalized) return null;
  const waves = unfinishedAfterWindow(race, categories, now);
  if (waves.length === 0) return null;
  const label = waves.map((w) => (w == null ? "no wave" : `Wave ${w}`)).join(", ");
  const first = waves.find((w): w is number => w != null);
  return (
    <div className={styles.banner} role="alert" data-testid="live-window-warning">
      <button type="button" className={styles.head} disabled={first == null || !onOpenWave} onClick={() => first != null && onOpenWave?.(first)}>
        <AlertTriangle size={16} className={styles.icon} />
        <span className={styles.title}>
          The 24 h live window has ended, but {label} {waves.length > 1 ? "are" : "is"} still running. Spectators see {waves.length > 1 ? "them" : "it"} as NOT FINISHED — finish {waves.length > 1 ? "them" : "it"} when the results are ready.
        </span>
        {first != null && onOpenWave && <span className={styles.fix}>Open ›</span>}
      </button>
    </div>
  );
};

export default LiveWindowWarning;
