import React, { useEffect, useState, useMemo } from "react";
import styles from "./liveBoard.module.css";
import { CategoryProps, RiderProps } from "@/types/types";
import useRiderStore from "@/stores/ridersStore";
import calculatePositions from "@/utils/calculatePosition";
import { parseClockTime } from "@/utils/timeUtils";
import { riderInCategory, withCategoryLaps } from "../schedule/Schedule";
import { Trophy, Flag, Zap, SlidersHorizontal } from "lucide-react";

interface Props {
  raceUuid: string;
  waveNum: number;
  categories: CategoryProps[];
}

const MEDAL = ["🥇", "🥈", "🥉"];

// Extra columns the board can show (off by default — see loadVisibleFields).
// Mirrors the Results "Columns" picker (results/Results.tsx) so both screens
// read as one system.
type BoardField = "gap" | "speed";
const BOARD_FIELDS: { key: BoardField; label: string }[] = [
  { key: "gap", label: "Gap to leader" },
  { key: "speed", label: "Speed" },
];
const FIELDS_STORAGE_KEY = "boardVisibleFields";

function loadVisibleFields(): Set<BoardField> {
  try {
    const raw = localStorage.getItem(FIELDS_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as BoardField[];
      return new Set(arr.filter((f) => BOARD_FIELDS.some((bf) => bf.key === f)));
    }
  } catch {
    /* ignore — fall through to default */
  }
  return new Set<BoardField>(); // off by default — keep the live board lean
}

function elapsedMs(rider: RiderProps): number {
  const start = parseClockTime(rider.timeStartRace);
  if (!start) return Infinity;
  const end = rider.timeArrive ? new Date(rider.timeArrive) : new Date();
  const ms = end.getTime() - start.getTime();
  return ms >= 0 ? ms : Infinity;
}

function elapsed(rider: RiderProps): string {
  const s = elapsedMs(rider);
  if (!isFinite(s)) return "—";
  const sec = Math.floor(s / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

// "+M:SS" behind the category leader on elapsed time — always a time diff,
// never a lap count, even when the rider is a lap down (user req). Same
// definition as Results' fmtGap.
function fmtGap(leader: RiderProps | null, rider: RiderProps): string {
  if (!leader || rider.id === leader.id) return "—";
  const diffMs = elapsedMs(rider) - elapsedMs(leader);
  if (!isFinite(diffMs) || diffMs <= 0) return "—";
  const s = Math.floor(diffMs / 1000);
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function riderSpeedKph(rider: RiderProps): string {
  const laps = rider.lapsDetails;
  const kph = laps && laps.length > 0 ? laps[laps.length - 1].speed_kph : undefined;
  return kph != null ? `${kph.toFixed(1)} km/h` : "—";
}

const LiveBoard: React.FC<Props> = ({ raceUuid, categories }) => {
  const { riders, getRiders } = useRiderStore();
  const [filterCat, setFilterCat] = useState("all");
  const [podiumMode, setPodiumMode] = useState(false);
  const [podiumSizes, setPodiumSizes] = useState<Record<string, 3 | 5>>({});
  const [visibleFields, setVisibleFields] = useState<Set<BoardField>>(loadVisibleFields);
  const [showFieldMenu, setShowFieldMenu] = useState(false);

  useEffect(() => { getRiders(raceUuid); }, [raceUuid, getRiders]);

  useEffect(() => {
    try {
      localStorage.setItem(FIELDS_STORAGE_KEY, JSON.stringify([...visibleFields]));
    } catch {
      /* storage unavailable — selection just won't persist */
    }
  }, [visibleFields]);

  const toggleField = (key: BoardField) =>
    setVisibleFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Only categories that have actually started (running/finished) belong on the
  // live board — riders from not-yet-started starts must not appear here.
  const startedCategories = categories.filter(
    (c) => c.status === "running" || c.status === "finished"
  );
  // Laps resolved from the category so the board reads 0/5, not 0/? (BUGS.md #7)
  const waveRiders = withCategoryLaps(
    riders.filter(
      (r) => r.raceUuid === raceUuid && startedCategories.some((c) => riderInCategory(r, c))
    ),
    startedCategories
  );
  const positioned = calculatePositions([...waveRiders]);

  const displayedCategories = useMemo(() => {
    const sorted = [...startedCategories].sort((a, b) => {
      const aFin = a.status === "finished", bFin = b.status === "finished";
      if (aFin && bFin) return (b.finishedAt ?? 0) - (a.finishedAt ?? 0);
      if (aFin) return -1;
      if (bFin) return 1;
      return 0;
    });
    return filterCat === "all" ? sorted : sorted.filter((c) => c.name === filterCat);
  }, [startedCategories, filterCat]);

  const getPodiumSize = (catName: string): 3 | 5 => podiumSizes[catName] ?? 3;
  const togglePodiumSize = (catName: string) =>
    setPodiumSizes((prev) => ({ ...prev, [catName]: prev[catName] === 5 ? 3 : 5 }));

  if (!categories.length) {
    return <div className={styles.empty}>No categories in this wave.</div>;
  }

  return (
    <div className={styles.container}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <select
          className={styles.filterSelect}
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
        >
          <option value="all">All categories</option>
          {startedCategories.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
        </select>
        <div className={styles.fieldMenuWrap}>
          <button
            className={styles.fieldMenuBtn}
            onClick={() => setShowFieldMenu((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={showFieldMenu}
            title="Choose columns"
          >
            <SlidersHorizontal size={15} /> Columns
          </button>
          {showFieldMenu && (
            <>
              <div className={styles.fieldMenuOverlay} onClick={() => setShowFieldMenu(false)} />
              <div className={styles.fieldMenu} role="menu">
                <div className={styles.fieldMenuTitle}>Show columns</div>
                {BOARD_FIELDS.map((f) => (
                  <label key={f.key} className={styles.fieldMenuItem}>
                    <input
                      type="checkbox"
                      checked={visibleFields.has(f.key)}
                      onChange={() => toggleField(f.key)}
                    />
                    <span>{f.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          className={`${styles.podiumToggle} ${podiumMode ? styles.podiumToggleOn : ""}`}
          onClick={() => setPodiumMode((v) => !v)}
        >
          <Trophy size={15} /> Podium
        </button>
      </div>

      {displayedCategories.length === 0 && (
        <div className={styles.empty}>No start has been started yet.</div>
      )}

      {displayedCategories.map((cat) => {
        const catRiders = positioned.filter((r) => riderInCategory(r, cat));
        const activeRiders = catRiders.filter((r) => !["DNF", "DSQ", "DNS"].includes(r.status));
        const finished = activeRiders.filter((r) => r.raceStatus === "finished").length;
        const onTrack  = activeRiders.filter((r) => r.raceStatus === "running").length;
        const allDone  = cat.status === "finished" || (activeRiders.length > 0 && onTrack === 0 && finished > 0);

        const podSize = getPodiumSize(cat.name);
        const candidates = [...activeRiders]
          .filter((r) => r.raceStatus === "running" || r.raceStatus === "finished")
          .sort((a, b) => (b.lapsCounter ?? 0) - (a.lapsCounter ?? 0) || (a.position_category ?? 999) - (b.position_category ?? 999));

        const display = podiumMode ? candidates.slice(0, podSize) : candidates.slice(0, 5);
        const leader = candidates[0] ?? null; // already place-ordered above
        // DNF/DSQ are shown (dropped from the race); DNS never started, so it's hidden.
        const outRiders = catRiders.filter((r) => ["DNF", "DSQ"].includes(r.status));

        return (
          <div key={cat.id} className={`${styles.catBlock} ${allDone ? styles.catBlockDone : ""}`}>
            <div className={`${styles.catHeader} ${allDone ? styles.catHeaderDone : ""}`}>
              <span className={styles.catDot} style={{ background: cat.color ?? "#ccc" }} />
              <span className={styles.catName}>
                {allDone && <span className={styles.flagIcon}><Flag size={13} /></span>}
                {cat.name}
              </span>
              {podiumMode && (
                <button
                  className={`${styles.podiumSizeBtn} ${podSize === 5 ? styles.podiumSize5 : ""}`}
                  onClick={() => togglePodiumSize(cat.name)}
                  title={`Top ${podSize} — click to toggle 3/5`}
                >
                  {podSize === 5 ? "Top 5" : "Top 3"}
                </button>
              )}
              <div className={styles.catStats}>
                {finished > 0 && <span className={styles.stat}>{allDone ? `${finished} fin` : <><Flag size={12} /> {finished}</>}</span>}
                {onTrack  > 0 && <span className={styles.stat}><Zap size={12} /> {onTrack}</span>}
              </div>
            </div>

            {(cat.laps ?? 0) > 0 && (() => {
              const maxLaps = catRiders.length > 0
                ? Math.max(0, ...catRiders.map((r) => r.lapsCounter || 0))
                : 0;
              return (
                <div className={styles.lapBar}>
                  {Array.from({ length: cat.laps! }, (_, i) => (
                    <div key={i} className={`${styles.lapSegment} ${i < maxLaps ? styles.lapSegmentDone : ""}`} />
                  ))}
                </div>
              );
            })()}

            {display.length === 0 ? (
              <div className={styles.noData}>{allDone ? "Race complete" : "Race not started"}</div>
            ) : (
              display.map((rider, i) => {
                const showMedal = podiumMode && i < 3;
                return (
                  <div
                    key={rider.id}
                    className={`${styles.row} ${rider.raceStatus === "finished" ? styles.finRow : styles.running} ${podiumMode && i < 3 ? styles[`rowP${i + 1}`] : ""}`}
                  >
                    <span className={styles.pos}>
                      {showMedal ? MEDAL[i] : `P${i + 1}`}
                    </span>
                    <span className={styles.bib}>#{rider.bibNumber}</span>
                    <span className={styles.name}>{rider.lastName} {rider.firstName}</span>
                    <span className={styles.laps}>{rider.lapsCounter ?? 0}/{rider.totalLaps ?? "?"}</span>
                    {visibleFields.has("gap") && (
                      <span className={styles.gap}>{fmtGap(leader, rider)}</span>
                    )}
                    {visibleFields.has("speed") && (
                      <span className={styles.speed}>{riderSpeedKph(rider)}</span>
                    )}
                    <span className={styles.time}>{elapsed(rider)}</span>
                  </div>
                );
              })
            )}

            {podiumMode && outRiders.length > 0 && (
              <div className={styles.outSummary}>
                {outRiders.map((r) => (
                  <span key={r.id} className={styles.outChip}>{r.status} #{r.bibNumber}</span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default LiveBoard;
