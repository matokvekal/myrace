import React, { useMemo, useState } from "react";
import styles from "./waveStatus.module.css";
import { CategoryProps, RiderProps } from "@/types/types";
import useRiderStore from "@/stores/ridersStore";
import { riderInCategory, withCategoryLaps } from "../schedule/Schedule";

/**
 * Every rider in the wave, exactly once, with where they currently stand
 * (BUGS.md #24).
 *
 * The Live grid deliberately only shows riders whose race has started, and moves
 * finishers into a separate section — so during a staggered wave there was no
 * single place to answer "where is everyone?". This view is read-only and
 * additive: it never records laps and doesn't change the Live view.
 */

interface Props {
  raceUuid: string;
  waveNum: number;
  categories: CategoryProps[];
}

type Bucket =
  | "Not started"
  | "Racing"
  | "On track"
  | "Finished"
  | "DNS"
  | "DNF"
  | "DSQ";

const BUCKET_ORDER: Bucket[] = [
  "Racing",
  "On track",
  "Not started",
  "Finished",
  "DNF",
  "DSQ",
  "DNS",
];

/** Bucket key on the class map, e.g. "On track" → "onTrack". */
const bucketClass = (b: Bucket) =>
  b.replace(/\s(.)/g, (_, c: string) => c.toUpperCase());

function bucketOf(rider: RiderProps, cat: CategoryProps | undefined): Bucket {
  if (rider.status === "DNS") return "DNS";
  if (rider.status === "DNF") return "DNF";
  if (rider.status === "DSQ") return "DSQ";
  if (rider.raceStatus === "finished") return "Finished";
  if (rider.raceStatus === "running") {
    // Their category's race has been flagged off but they're still out there.
    return cat?.status === "finished" ? "On track" : "Racing";
  }
  return "Not started";
}

const WaveStatus: React.FC<Props> = ({ raceUuid, categories }) => {
  const riders = useRiderStore((s) => s.riders);
  const [filter, setFilter] = useState<Bucket | "All">("All");

  const rows = useMemo(() => {
    const inWave = riders.filter(
      (r) => r.raceUuid === raceUuid && categories.some((c) => riderInCategory(r, c))
    );
    // Laps resolved from the category, the shared rule.
    return withCategoryLaps(inWave, categories)
      .map((rider) => {
        const cat = categories.find((c) => riderInCategory(rider, c));
        return { rider, cat, bucket: bucketOf(rider, cat) };
      })
      .sort((a, b) => {
        const ba = BUCKET_ORDER.indexOf(a.bucket);
        const bb = BUCKET_ORDER.indexOf(b.bucket);
        if (ba !== bb) return ba - bb;
        const pa = a.rider.position_category || 999;
        const pb = b.rider.position_category || 999;
        if (pa !== pb) return pa - pb;
        return a.rider.bibNumber - b.rider.bibNumber;
      });
  }, [riders, raceUuid, categories]);

  const counts = useMemo(() => {
    const map = new Map<Bucket, number>();
    rows.forEach(({ bucket }) => map.set(bucket, (map.get(bucket) ?? 0) + 1));
    return map;
  }, [rows]);

  const shown = filter === "All" ? rows : rows.filter((r) => r.bucket === filter);

  if (categories.length === 0) {
    return <div className={styles.empty}>No categories in this wave.</div>;
  }

  return (
    <div className={styles.container} data-testid="wave-status">
      <div className={styles.filterBar}>
        <button
          className={`${styles.chip} ${filter === "All" ? styles.chipActive : ""}`}
          onClick={() => setFilter("All")}
          data-testid="wave-status-filter-all"
        >
          All <span className={styles.chipCount}>{rows.length}</span>
        </button>
        {BUCKET_ORDER.filter((b) => (counts.get(b) ?? 0) > 0).map((b) => (
          <button
            key={b}
            className={`${styles.chip} ${styles[bucketClass(b)]} ${
              filter === b ? styles.chipActive : ""
            }`}
            onClick={() => setFilter(b)}
          >
            {b} <span className={styles.chipCount}>{counts.get(b)}</span>
          </button>
        ))}
      </div>

      <div className={styles.list}>
        {shown.map(({ rider, cat, bucket }) => (
          <div
            key={rider.id}
            className={styles.row}
            data-testid={`wave-status-row-${rider.bibNumber}`}
            data-bucket={bucket}
          >
            <span
              className={styles.colorBar}
              style={{ background: cat?.color ?? rider.color ?? "#ccc" }}
            />
            <span className={styles.bib}>#{rider.bibNumber}</span>
            <span className={styles.name} dir="auto">
              {rider.lastName} {rider.firstName}
            </span>
            <span className={styles.cat} dir="auto">
              {rider.category}
            </span>
            <span className={styles.laps}>
              {rider.lapsCounter ?? 0}/{rider.totalLaps ?? "?"}
            </span>
            <span className={`${styles.badge} ${styles[bucketClass(bucket)]}`}>
              {bucket}
            </span>
          </div>
        ))}
        {shown.length === 0 && (
          <div className={styles.empty}>No riders with that status.</div>
        )}
      </div>
    </div>
  );
};

export default WaveStatus;
