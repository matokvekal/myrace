import React, { useState, useEffect, useMemo, useRef } from "react";
import styles from "./riders.module.css";
import Button from "@/components/ui/Button";
import useRiderStore from "@/stores/ridersStore";
import { CategoryProps, RiderProps } from "@/types/types";
import RiderCard from "../../components/riderCard/RiderCard";
import Icons from "@/constants/Icons";
import { shallow } from "zustand/shallow";
import { debounce } from "lodash";

interface ManageHeatProps {
  raceUuid: string;
  categories: CategoryProps[];
}

type SortKey = "name" | "bib" | "club";
type WaveFilter = "all" | "now" | number;

function getNowWave(categories: CategoryProps[]): number | null {
  const now = new Date();
  const todayPrefix = now.toISOString().slice(0, 10);
  const waveMap = new Map<number, Date>();
  categories.forEach((cat) => {
    if (cat.heat == null || !cat.startTime) return;
    const dt = new Date(`${todayPrefix}T${cat.startTime}`);
    if (!waveMap.has(cat.heat) || dt < waveMap.get(cat.heat)!) {
      waveMap.set(cat.heat, dt);
    }
  });
  if (waveMap.size === 0) return null;
  let closest: number | null = null;
  let minDiff = Infinity;
  waveMap.forEach((dt, heat) => {
    const diff = Math.abs(dt.getTime() - now.getTime());
    if (diff < minDiff) {
      minDiff = diff;
      closest = heat;
    }
  });
  return closest;
}

const Riders: React.FC<ManageHeatProps> = ({ raceUuid, categories }) => {
  const previousRaceUuid = useRef<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [waveFilter, setWaveFilter] = useState<WaveFilter>("all");
  const [groupByCategory, setGroupByCategory] = useState(false);

  const { getRiders, riders } = useRiderStore(
    (state) => ({ getRiders: state.getRiders, riders: state.riders }),
    shallow
  );

  useEffect(() => {
    if (previousRaceUuid.current !== raceUuid) {
      getRiders(raceUuid);
      previousRaceUuid.current = raceUuid;
    }
  }, [raceUuid, getRiders]);

  useEffect(() => {
    const handleScroll = debounce(() => setIsVisible(window.scrollY > 50), 100);
    window.addEventListener("scroll", handleScroll);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      handleScroll.cancel();
    };
  }, []);

  const waves = useMemo(
    () =>
      [
        ...new Set(
          categories.map((c) => c.heat).filter((h): h is number => h != null)
        )
      ].sort((a, b) => a - b),
    [categories]
  );

  const filteredAndSorted = useMemo(() => {
    const activeHeat =
      waveFilter === "now"
        ? getNowWave(categories)
        : typeof waveFilter === "number"
          ? waveFilter
          : null;

    let list = riders.filter((r) => r.raceUuid === raceUuid);
    if (activeHeat != null) list = list.filter((r) => r.heat === activeHeat);

    return [...list].sort((a, b) => {
      if (sortBy === "name")
        return `${a.lastName} ${a.firstName}`.localeCompare(
          `${b.lastName} ${b.firstName}`
        );
      if (sortBy === "bib") return a.bibNumber - b.bibNumber;
      if (sortBy === "club") return (a.team ?? "").localeCompare(b.team ?? "");
      return 0;
    });
  }, [riders, raceUuid, waveFilter, sortBy, categories]);

  const grouped = useMemo((): Map<string, RiderProps[]> | null => {
    if (!groupByCategory) return null;
    const map = new Map<string, RiderProps[]>();
    filteredAndSorted.forEach((r) => {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category)!.push(r);
    });
    return map;
  }, [filteredAndSorted, groupByCategory]);

  return (
    <div className={styles.riders}>
      <div className={styles.sortBar}>
        {(["name", "bib", "club"] as SortKey[]).map((key) => (
          <Button
            key={key}
            variant={sortBy === key ? "primary" : "secondary"}
            size="sm"
            className={`${styles.sortBtn} ${sortBy === key ? styles.sortActive : ""}`}
            onClick={() => setSortBy(key)}
          >
            {key === "name" ? "Name A–Z" : key === "bib" ? "Bib #" : "Club A–Z"}
          </Button>
        ))}
        <Button
          variant={groupByCategory ? "primary" : "secondary"}
          size="sm"
          className={`${styles.sortBtn} ${groupByCategory ? styles.sortActive : ""}`}
          onClick={() => setGroupByCategory((v) => !v)}
        >
          Group
        </Button>
      </div>

      {waves.length > 1 && (
        <div className={styles.wavePills}>
          <Button
            variant={waveFilter === "all" ? "primary" : "secondary"}
            size="sm"
            className={`${styles.pill} ${waveFilter === "all" ? styles.pillActive : ""}`}
            onClick={() => setWaveFilter("all")}
          >
            All
          </Button>
          {waves.map((w) => (
            <Button
              key={w}
              variant={waveFilter === w ? "primary" : "secondary"}
              size="sm"
              className={`${styles.pill} ${waveFilter === w ? styles.pillActive : ""}`}
              onClick={() => setWaveFilter(w)}
            >
              Wave {w}
            </Button>
          ))}
          <Button
            variant={waveFilter === "now" ? "success" : "secondary"}
            size="sm"
            className={`${styles.pill} ${styles.pillNow} ${waveFilter === "now" ? styles.pillActive : ""}`}
            onClick={() => setWaveFilter("now")}
          >
            NOW
          </Button>
        </div>
      )}

      {filteredAndSorted.length > 0 && (
        <div className={styles.tabCount}>
          Riders ({filteredAndSorted.length})
        </div>
      )}

      {filteredAndSorted.length > 0 ? (
        <>
          {groupByCategory && grouped
            ? [...grouped.entries()].map(([catName, catRiders]) => (
                <div key={catName} className={styles.catGroup}>
                  <div className={styles.catGroupHeader}>{catName}</div>
                  {catRiders.map((rider) => (
                    <RiderCard key={rider.id} {...rider} />
                  ))}
                </div>
              ))
            : filteredAndSorted.map((rider) => (
                <RiderCard key={rider.id} {...rider} />
              ))}

          <div
            className={`${styles.goUp} ${isVisible ? styles.show : styles.hide}`}
          >
            <img
              src={Icons.goup}
              alt="go up"
              width={20}
              height={20}
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            />
          </div>
        </>
      ) : (
        <p className={styles.empty}>No riders found.</p>
      )}
    </div>
  );
};

export default React.memo(Riders);
