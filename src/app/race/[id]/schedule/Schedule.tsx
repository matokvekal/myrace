import React from "react";
import styles from "./schedule.module.css";
import ButtonStart from "../../components/buttons/ButtonStart";
import ButtonRunning from "../../components/buttons/ButtonRunning";
import { useNavigate } from "react-router-dom";
import { CategoryProps } from "@/types/types";
import Icons from "@/constants/Icons";

interface Props {
  raceUuid: string;
  categories: CategoryProps[];
}

/** Group categories into waves (heat number) then start groups (startTime) */
function buildSchedule(categories: CategoryProps[]) {
  const waveMap = new Map<number, Map<string, CategoryProps[]>>();
  const sorted = [...categories].sort((a, b) => {
    if ((a.heat ?? 0) !== (b.heat ?? 0)) return (a.heat ?? 0) - (b.heat ?? 0);
    return (a.startTime ?? "").localeCompare(b.startTime ?? "");
  });

  for (const cat of sorted) {
    const wave = cat.heat ?? 0;
    const startKey = cat.startTime ?? "TBD";
    if (!waveMap.has(wave)) waveMap.set(wave, new Map());
    const startMap = waveMap.get(wave)!;
    if (!startMap.has(startKey)) startMap.set(startKey, []);
    startMap.get(startKey)!.push(cat);
  }
  return waveMap;
}

const STATUS_COLOR: Record<string, string> = {
  running: "#3edda4",
  upcoming: "#63a6fc",
  finished: "#aaa",
};

const Schedule: React.FC<Props> = ({ raceUuid, categories }) => {
  const navigate = useNavigate();
  const schedule = buildSchedule(categories);

  if (!categories.length) {
    return <div className={styles.empty}>No categories yet. Import riders to generate them.</div>;
  }

  return (
    <div className={styles.container}>
      {[...schedule.entries()].map(([waveNum, startMap]) => {
        const firstTime = [...startMap.keys()][0];
        return (
          <div key={waveNum} className={styles.wave}>
            <div className={styles.waveHeader}>
              <span className={styles.waveLabel}>Wave {waveNum}</span>
              {firstTime !== "TBD" && <span className={styles.waveTime}>{firstTime}</span>}
              <button
                className={styles.liveBtn}
                onClick={() => navigate(`/race/${raceUuid}/heat/${waveNum}`)}
              >
                <img src={Icons.buttonStart} alt="" width={12} height={12} />
                Go Live
              </button>
            </div>

            {[...startMap.entries()].map(([startTime, cats], si) => (
              <div key={startTime} className={styles.startGroup}>
                <div className={styles.startHeader}>
                  Start {si + 1}
                  {startTime !== "TBD" && <span className={styles.startTime}> · {startTime}</span>}
                </div>

                {cats.map((cat) => (
                  <div key={cat.id} className={styles.categoryRow}>
                    <div className={styles.colorDot} style={{ background: cat.color ?? "#ccc" }} />
                    <div className={styles.catInfo}>
                      <span className={styles.catName}>{cat.name}</span>
                      <span className={styles.catMeta}>
                        {cat.riders ?? 0} riders · {cat.lapsCounter ?? 0}/{cat.laps ?? 0} laps
                      </span>
                    </div>
                    <span
                      className={styles.statusBadge}
                      style={{ color: STATUS_COLOR[cat.status ?? "upcoming"] }}
                    >
                      {cat.status ?? "upcoming"}
                    </span>
                    <div className={styles.catActions}>
                      {cat.status === "upcoming" && <ButtonStart category={cat} />}
                      {cat.status === "running" && <ButtonRunning category={cat} />}
                      <button
                        className={styles.standingsBtn}
                        onClick={() =>
                          navigate(
                            `/race/${raceUuid}/standing/${waveNum}?category=${encodeURIComponent(cat.name)}`
                          )
                        }
                      >
                        Standings
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
};

export default Schedule;
