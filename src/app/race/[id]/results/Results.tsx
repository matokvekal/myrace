import React, { useEffect, useMemo, useState } from "react";
import styles from "./results.module.css";
import Button from "@/components/ui/Button";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import { RiderProps } from "@/types/types";
import RiderDetailModal from "../../components/riderDetailModal/RiderDetailModal";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES, catWaveKey, withCategoryLaps } from "../schedule/Schedule";
import { Trophy, SlidersHorizontal } from "lucide-react";
import { getRiderStatusInfo, getCategoryStatusInfo } from "@/utils/statusChip";
import { parseClockTime } from "@/utils/timeUtils";

interface Props {
  raceUuid: string;
}

type SortKey = "place" | "name" | "bib" | "time";
type GroupBy = "category" | "wave";

// Columns the user can show/hide on Results (BUGS.md #8). Position and Name are
// always shown — Name is the whole point ("we cant see the name in some case").
type ResultField = "bib" | "laps" | "time" | "status";
const RESULT_FIELDS: { key: ResultField; label: string }[] = [
  { key: "bib", label: "Bib #" },
  { key: "laps", label: "Laps" },
  { key: "time", label: "Time" },
  { key: "status", label: "Status" },
];
const FIELDS_STORAGE_KEY = "resultsVisibleFields";

function loadVisibleFields(): Set<ResultField> {
  try {
    const raw = localStorage.getItem(FIELDS_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as ResultField[];
      return new Set(arr.filter((f) => RESULT_FIELDS.some((rf) => rf.key === f)));
    }
  } catch {
    /* ignore — fall through to default */
  }
  return new Set<ResultField>(["bib", "laps", "time", "status"]); // all on by default
}

const MEDAL = ["🥇", "🥈", "🥉"];

function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function riderElapsed(rider: RiderProps): number {
  // `timeStartRace` is a wall-clock string ("08:04:31"), NOT a date — feeding it
  // to `new Date()` yields Invalid Date, so every elapsed time came out NaN and
  // rendered as "—" (and the Time sort silently compared NaN). Parse it with the
  // shared helper that already handles this format (BUGS.md #30).
  const start = parseClockTime(rider.timeStartRace);
  if (!start) return Infinity;
  const end = rider.timeArrive ? new Date(rider.timeArrive).getTime() : Date.now();
  if (isNaN(end)) return Infinity;
  const ms = end - start.getTime();
  return ms >= 0 ? ms : Infinity;
}

const Results: React.FC<Props> = ({ raceUuid }) => {
  const { riders, getRiders } = useRiderStore();
  const { categories } = useCategoryStore();
  const [sortBy, setSortBy] = useState<SortKey>("place");
  const [filterCategory, setFilterCategory] = useState("all");
  const [waveFilter, setWaveFilter] = useState<"all" | number>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("category");
  const [podiumMode, setPodiumMode] = useState(false);
  const [podiumSizes, setPodiumSizes] = useState<Record<string, 3 | 5>>({});
  const [selectedRider, setSelectedRider] = useState<RiderProps | null>(null);
  const [visibleFields, setVisibleFields] = useState<Set<ResultField>>(loadVisibleFields);
  const [showFieldMenu, setShowFieldMenu] = useState(false);

  useEffect(() => { getRiders(raceUuid); }, [raceUuid, getRiders]);

  // Persist the chosen columns as the default for next time (BUGS.md #8).
  useEffect(() => {
    try {
      localStorage.setItem(FIELDS_STORAGE_KEY, JSON.stringify([...visibleFields]));
    } catch {
      /* storage unavailable — selection just won't persist */
    }
  }, [visibleFields]);

  const toggleField = (key: ResultField) =>
    setVisibleFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const raceCategories = useMemo(
    () => categories.filter((c) => c.raceUuid === raceUuid),
    [categories, raceUuid]
  );
  // Laps resolved from the category so results read 0/5, not 0/0 (BUGS.md #7)
  const raceRiders = useMemo(
    () => withCategoryLaps(riders.filter((r) => r.raceUuid === raceUuid), raceCategories),
    [riders, raceUuid, raceCategories]
  );

  const { waveNums, catWaveMap } = useMemo(() => {
    const schedule = buildSchedule(raceCategories, DEFAULT_WAVE_GAP_MINUTES);
    const map = new Map<string, number>();
    schedule.forEach((startMap, waveNum) => {
      startMap.forEach((cats) => cats.forEach((cat) => map.set(catWaveKey(cat.name, cat.subCategory), waveNum)));
    });
    return { waveNums: [...schedule.keys()].sort((a, b) => a - b), catWaveMap: map };
  }, [raceCategories]);

  // A "category" here is identified by name + subCategory (composite key), so
  // e.g. "Masters Men " 19-29 and 30-49 are separate blocks in the right waves.
  const catIdents = useMemo(() => {
    const map = new Map<string, { name: string; sub: string | null }>();
    raceRiders.forEach((r) => {
      map.set(catWaveKey(r.category, r.subCategory), { name: r.category, sub: r.subCategory ?? null });
    });
    return map;
  }, [raceRiders]);

  const allCatKeys = useMemo(
    () => [...catIdents.keys()].sort(),
    [catIdents]
  );

  const sortGroup = (group: RiderProps[]) =>
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

  const filteredCatKeys = useMemo(() => {
    let keys = allCatKeys;
    if (waveFilter !== "all") keys = keys.filter((k) => catWaveMap.get(k) === waveFilter);
    if (filterCategory !== "all") keys = keys.filter((k) => k === filterCategory);
    return keys;
  }, [allCatKeys, waveFilter, filterCategory, catWaveMap]);

  const getPodiumSize = (catKey: string): 3 | 5 => podiumSizes[catKey] ?? 3;

  const togglePodiumSize = (catKey: string) =>
    setPodiumSizes((prev) => ({ ...prev, [catKey]: prev[catKey] === 5 ? 3 : 5 }));

  const renderCategory = (catKey: string) => {
    const ident = catIdents.get(catKey);
    if (!ident) return null;
    const { name, sub } = ident;
    const waveNum = catWaveMap.get(catKey);
    const allInCat = raceRiders.filter(
      (r) => r.category === name && (r.subCategory ?? null) === sub
    );
    const sorted = sortGroup(allInCat);
    if (!sorted.length) return null;
    const catMeta = raceCategories.find(
      (c) => c.name === name && (c.subCategory ?? null) === sub
    );
    const podSize = getPodiumSize(catKey);
    const active = sorted.filter((r) => !["DNS", "DNF", "DSQ"].includes(r.status));
    const out = sorted.filter((r) => ["DNS", "DNF", "DSQ"].includes(r.status));
    const display = podiumMode ? active.slice(0, podSize) : sorted;

    return (
      <div key={catKey} className={styles.categoryBlock}>
        <div className={styles.categoryHeader}>
          {catMeta && <span className={styles.dot} style={{ background: catMeta.color ?? "#ccc" }} />}
          <span className={styles.catHeaderName}>{name}{sub ? ` · ${sub}` : ""}</span>
          {(() => {
            const info = getCategoryStatusInfo(catMeta?.status);
            return (
              <span
                className={styles.statusChip}
                style={{ background: `${info.color}1f`, color: info.color }}
              >
                {info.label}
              </span>
            );
          })()}
          {waveNum != null && <span className={styles.count}>Wave {waveNum}</span>}
          {podiumMode && (
            <button
              className={`${styles.podiumSizeBtn} ${podSize === 5 ? styles.podiumSize5 : ""}`}
              onClick={() => togglePodiumSize(catKey)}
              title={`Top ${podSize} — click to toggle 3/5`}
            >
              {podSize === 5 ? "Top 5" : "Top 3"}
            </button>
          )}
          <span className={styles.count}>{sorted.length}</span>
        </div>

        {display.map((rider, idx) => {
          const isActive = rider.raceStatus === "running";
          const isOut = ["DNS", "DNF", "DSQ"].includes(rider.status);
          const el = isOut ? null : riderElapsed(rider);
          const showMedal = podiumMode && sortBy === "place" && !isOut && idx < 3;
          const posLabel = isOut ? "—" : sortBy === "place" ? String(idx + 1) : "·";
          const podiumRowClass = podiumMode && !isOut && sortBy === "place"
            ? idx === 0 ? styles.rowGold : idx === 1 ? styles.rowSilver : idx === 2 ? styles.rowBronze : ""
            : "";

          return (
            <div
              key={rider.id}
              className={`${styles.row} ${isActive ? styles.active : ""} ${isOut ? styles.out : ""} ${podiumRowClass}`}
              onClick={() => setSelectedRider(rider)}
            >
              <span className={`${styles.pos} ${podiumMode && sortBy === "place" && !isOut && idx < 3 ? styles[`pos${idx + 1}`] : ""}`}>
                {showMedal ? MEDAL[idx] : posLabel}
              </span>
              {visibleFields.has("bib") && <span className={styles.bib}>#{rider.bibNumber}</span>}
              <span className={styles.name}>{rider.lastName} {rider.firstName}</span>
              {visibleFields.has("laps") && <span className={styles.laps}>{rider.lapsCounter}/{rider.totalLaps}</span>}
              {visibleFields.has("time") && (
                <span className={styles.time}>
                  {el && el !== Infinity ? fmtTime(el) : "—"}
                </span>
              )}
              {visibleFields.has("status") && (() => {
                const info = getRiderStatusInfo(rider);
                return (
                  <span
                    className={styles.statusChip}
                    style={{ background: `${info.color}1f`, color: info.color }}
                  >
                    {info.label}
                  </span>
                );
              })()}
            </div>
          );
        })}

        {podiumMode && out.length > 0 && (
          <div className={styles.outSummary}>
            {out.map((r) => (
              <span key={r.id} className={styles.outChip}>{r.status} #{r.bibNumber}</span>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      {waveNums.length > 1 && (
        <div className={styles.wavePills}>
          <button
            className={`${styles.wavePill} ${waveFilter === "all" ? styles.wavePillActive : ""}`}
            onClick={() => setWaveFilter("all")}
          >All</button>
          {waveNums.map((w) => (
            <button
              key={w}
              className={`${styles.wavePill} ${waveFilter === w ? styles.wavePillActive : ""}`}
              onClick={() => setWaveFilter(w)}
            >Wave {w}</button>
          ))}
        </div>
      )}

      <div className={styles.toolbar}>
        <div className={styles.toolRow}>
          <select
            className={styles.select}
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="all">All categories</option>
            {allCatKeys.map((k) => {
              const ident = catIdents.get(k);
              const label = ident ? `${ident.name}${ident.sub ? ` · ${ident.sub}` : ""}` : k;
              return <option key={k} value={k}>{label}</option>;
            })}
          </select>
          <div className={styles.groupBtns}>
            <button
              className={`${styles.groupBtn} ${groupBy === "category" ? styles.groupBtnActive : ""}`}
              onClick={() => setGroupBy("category")}
            >Cat</button>
            <button
              className={`${styles.groupBtn} ${groupBy === "wave" ? styles.groupBtnActive : ""}`}
              onClick={() => setGroupBy("wave")}
            >Wave</button>
          </div>
        </div>

        <div className={styles.toolRow}>
          <div className={styles.sortBtns}>
            {(["place", "name", "bib", "time"] as SortKey[]).map((k) => (
              <Button
                key={k}
                variant={sortBy === k ? "primary" : "secondary"}
                size="sm"
                className={`${styles.sortBtn} ${sortBy === k ? styles.active : ""}`}
                onClick={() => setSortBy(k)}
              >
                {k === "place" ? "Place" : k === "name" ? "Name" : k === "bib" ? "Bib" : "Time"}
              </Button>
            ))}
          </div>
          <div className={styles.rightTools}>
            {/* Column picker — persisted so it's the default next time (BUGS.md #8) */}
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
                    {RESULT_FIELDS.map((f) => (
                      <label key={f.key} className={styles.fieldMenuItem}>
                        <input
                          type="checkbox"
                          checked={visibleFields.has(f.key)}
                          onChange={() => toggleField(f.key)}
                        />
                        <span>{f.label}</span>
                      </label>
                    ))}
                    <div className={styles.fieldMenuNote}>Name is always shown.</div>
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
        </div>
      </div>

      {selectedRider && (
        <RiderDetailModal rider={selectedRider} onClose={() => setSelectedRider(null)} />
      )}

      {groupBy === "wave"
        ? waveNums
            .filter((w) => waveFilter === "all" || waveFilter === w)
            .map((w) => {
              const cats = filteredCatKeys.filter((k) => catWaveMap.get(k) === w);
              if (!cats.length) return null;
              return (
                <div key={w}>
                  <div className={styles.waveGroupHeader}>Wave {w}</div>
                  {cats.map(renderCategory)}
                </div>
              );
            })
        : filteredCatKeys.map(renderCategory)
      }
    </div>
  );
};

export default Results;
