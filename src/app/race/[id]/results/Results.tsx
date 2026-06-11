import React, { useEffect, useMemo, useState } from "react";
import styles from "./results.module.css";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import { RiderProps } from "@/types/types";

interface Props {
  raceUuid: string;
}

type SortKey = "place" | "name" | "bib" | "time";

const STATUS_ICON: Record<string, string> = {
  finished: "✓",
  running: "⚡",
  DNS: "✗",
  DNF: "✗",
  DSQ: "✗",
  standing: "·",
};

function formatTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function riderElapsed(rider: RiderProps): number {
  if (!rider.timeStartRace) return Infinity;
  const start = new Date(rider.timeStartRace).getTime();
  const end = rider.timeArrive ? new Date(rider.timeArrive).getTime() : Date.now();
  return end - start;
}

const Results: React.FC<Props> = ({ raceUuid }) => {
  const { riders, getRiders } = useRiderStore();
  const { categories } = useCategoryStore();
  const [sortBy, setSortBy] = useState<SortKey>("place");
  const [filterCategory, setFilterCategory] = useState("all");

  useEffect(() => {
    getRiders(raceUuid);
  }, [raceUuid, getRiders]);

  const raceRiders = riders.filter((r) => r.raceUuid === raceUuid);
  const raceCategories = useMemo(
    () => [...new Set(raceRiders.map((r) => r.category))].sort(),
    [raceRiders]
  );

  const sorted = (group: RiderProps[]) =>
    [...group].sort((a, b) => {
      if (sortBy === "place") {
        if (a.lapsCounter !== b.lapsCounter) return b.lapsCounter - a.lapsCounter;
        return riderElapsed(a) - riderElapsed(b);
      }
      if (sortBy === "name") return `${a.lastName}${a.firstName}`.localeCompare(`${b.lastName}${b.firstName}`);
      if (sortBy === "bib") return a.bibNumber - b.bibNumber;
      if (sortBy === "time") return riderElapsed(a) - riderElapsed(b);
      return 0;
    });

  const displayed = filterCategory === "all"
    ? raceCategories
    : [filterCategory];

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <select
          className={styles.select}
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          <option value="all">All categories</option>
          {raceCategories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <div className={styles.sortBtns}>
          {(["place", "name", "bib", "time"] as SortKey[]).map((k) => (
            <button
              key={k}
              className={`${styles.sortBtn} ${sortBy === k ? styles.active : ""}`}
              onClick={() => setSortBy(k)}
            >
              {k.charAt(0).toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {displayed.map((catName) => {
        const group = sorted(raceRiders.filter((r) => r.category === catName));
        const catMeta = categories.find((c) => c.name === catName && c.raceUuid === raceUuid);
        if (!group.length) return null;
        return (
          <div key={catName} className={styles.categoryBlock}>
            <div className={styles.categoryHeader}>
              {catMeta && <span className={styles.dot} style={{ background: catMeta.color ?? "#ccc" }} />}
              {catName}
              <span className={styles.count}>{group.length} riders</span>
            </div>
            {group.map((rider, idx) => {
              const isActive = rider.status === "running";
              const isDone = rider.status === "finished";
              const isOut = ["DNS","DNF","DSQ"].includes(rider.status);
              const elapsed = isOut ? null : riderElapsed(rider);
              return (
                <div key={rider.id} className={`${styles.row} ${isActive ? styles.active : ""} ${isOut ? styles.out : ""}`}>
                  <span className={styles.pos}>
                    {isOut ? "—" : sortBy === "place" ? idx + 1 : "·"}
                  </span>
                  <span className={styles.bib}>#{rider.bibNumber}</span>
                  <span className={styles.name}>
                    {rider.lastName} {rider.firstName}
                  </span>
                  <span className={styles.laps}>
                    {rider.lapsCounter}/{rider.totalLaps}
                  </span>
                  <span className={styles.time}>
                    {elapsed && elapsed !== Infinity ? formatTime(elapsed) : "—"}
                  </span>
                  <span className={`${styles.statusIcon} ${isDone ? styles.done : isOut ? styles.outIcon : ""}`}>
                    {STATUS_ICON[rider.status] ?? "·"}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};

export default Results;
