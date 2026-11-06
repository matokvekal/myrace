import React, { useEffect, useMemo, useState } from "react";
import BibBadge from "@/components/ui/BibBadge";
import styles from "./results.module.css";
import useRiderStore from "@/stores/ridersStore";
import { withoutIgnoredRiders } from "@/utils/ignoredWaves";
import { isAdministrativeFinish } from "@/utils/waveFinish";
import useCategoryStore from "@/stores/categoryStore";
import { RiderProps } from "@/types/types";
import RiderDetailModal from "../../components/riderDetailModal/RiderDetailModal";
import RiderLapTable from "./RiderLapTable";
import ResultCorrection from "./ResultCorrection";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES, catWaveKey, withCategoryLaps } from "../schedule/Schedule";
import { Trophy, SlidersHorizontal, ListFilter, Check, RefreshCw } from "lucide-react";
import { refreshRaceData } from "@/services/live/liveRaceRoom";
import { getRiderStatusInfo, getCategoryStatusInfo } from "@/utils/statusChip";
import { parseClockTime } from "@/utils/timeUtils";

interface Props {
  raceUuid: string;
  /** Initial grouping — the dedicated Results screen opens grouped Wave → Category. */
  defaultGroupBy?: GroupBy;
  /** Open with the wave filter preset (e.g. from a completed wave on the Race timeline). */
  defaultWave?: number;
}

type SortKey = "place" | "name" | "bib" | "time";
// Place is the default ranking; the others reorder rows inside each category.
const SORTS: { key: SortKey; label: string }[] = [
  { key: "place", label: "Place" },
  { key: "time", label: "Time" },
  { key: "name", label: "Name" },
  { key: "bib", label: "Bib" },
];
type GroupBy = "category" | "wave";

// Columns the user can show/hide on Results (BUGS.md #8). Position and Name are
// always shown — Name is the whole point ("we cant see the name in some case").
// Gap/Speed default OFF (see loadVisibleFields) — keep the results list lean by
// default and let commissaires opt into the denser view.
type ResultField = "bib" | "laps" | "time" | "status" | "gap" | "speed";
const RESULT_FIELDS: { key: ResultField; label: string }[] = [
  { key: "bib", label: "Bib" },
  { key: "laps", label: "Laps" },
  { key: "time", label: "Time" },
  { key: "status", label: "Status" },
  { key: "gap", label: "Gap to leader" },
  { key: "speed", label: "Speed" },
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

// "+M:SS" behind the category leader on elapsed time — always a time diff,
// never a lap count, even when the rider is a lap down (user req).
function fmtGap(leader: RiderProps | null, rider: RiderProps): string {
  if (!leader || rider.id === leader.id) return "—";
  const diffMs = riderElapsed(rider) - riderElapsed(leader);
  if (!isFinite(diffMs) || diffMs <= 0) return "—";
  const s = Math.floor(diffMs / 1000);
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Last recorded lap's speed (BUGS.md-style derived field — km/h needs
// `race.distance` set as the circuit length; see useLapRecording.ts).
function riderSpeedKph(rider: RiderProps): string {
  const laps = rider.lapsDetails;
  const kph = laps && laps.length > 0 ? laps[laps.length - 1].speed_kph : undefined;
  return kph != null ? `${kph.toFixed(1)} km/h` : "—";
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

const Results: React.FC<Props> = ({ raceUuid, defaultGroupBy = "category", defaultWave }) => {
  const { riders, getRiders } = useRiderStore();
  const { categories } = useCategoryStore();
  const [sortBy, setSortBy] = useState<SortKey>("place");
  const [filterCategory, setFilterCategory] = useState("all");
  const [waveFilter, setWaveFilter] = useState<"all" | number>(defaultWave ?? "all");
  const [groupBy, setGroupBy] = useState<GroupBy>(defaultGroupBy);
  const [podiumMode, setPodiumMode] = useState(false);
  const [podiumSizes, setPodiumSizes] = useState<Record<string, 3 | 5>>({});
  const [selectedRider, setSelectedRider] = useState<RiderProps | null>(null);
  const [visibleFields, setVisibleFields] = useState<Set<ResultField>>(loadVisibleFields);
  const [showFieldMenu, setShowFieldMenu] = useState(false);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshRaceData(raceUuid);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { getRiders(raceUuid); }, [raceUuid, getRiders]);

  useEffect(() => {
    if (!showFilterMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowFilterMenu(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showFilterMenu]);

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

  // Ignored waves are left out of results (their data is kept).
  const raceCategories = useMemo(
    () => categories.filter((c) => c.raceUuid === raceUuid && !c.ignored),
    [categories, raceUuid]
  );
  // Laps resolved from the category so results read 0/5, not 0/0 (BUGS.md #7)
  const raceRiders = useMemo(
    () => withCategoryLaps(withoutIgnoredRiders(riders.filter((r) => r.raceUuid === raceUuid), categories), raceCategories),
    [riders, raceUuid, raceCategories, categories]
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

  // Categories offered in the filter: those of the chosen wave.
  const waveCatKeys = useMemo(
    () => (waveFilter === "all" ? allCatKeys : allCatKeys.filter((k) => catWaveMap.get(k) === waveFilter)),
    [allCatKeys, waveFilter, catWaveMap]
  );
  const filteredCatKeys = useMemo(
    () => (filterCategory === "all" ? waveCatKeys : waveCatKeys.filter((k) => k === filterCategory)),
    [waveCatKeys, filterCategory]
  );
  const pickWave = (w: "all" | number) => {
    setWaveFilter(w);
    // A category outside the new wave would leave the page empty.
    if (filterCategory !== "all" && w !== "all" && catWaveMap.get(filterCategory) !== w) setFilterCategory("all");
  };
  const filtersActive = sortBy !== "place" || filterCategory !== "all" || waveFilter !== "all";
  const catLabel = (k: string) => {
    const ident = catIdents.get(k);
    return ident ? `${ident.name}${ident.sub ? ` · ${ident.sub}` : ""}` : k;
  };
  const catColor = (k: string) => {
    const ident = catIdents.get(k);
    return raceCategories.find((c) => ident && c.name === ident.name && (c.subCategory ?? null) === ident.sub)?.color ?? "#ccc";
  };

  const getPodiumSize = (catKey: string): 3 | 5 => podiumSizes[catKey] ?? 3;

  const togglePodiumSize = (catKey: string) =>
    setPodiumSizes((prev) => ({ ...prev, [catKey]: prev[catKey] === 5 ? 3 : 5 }));

  const hasFields = (["laps", "time", "gap", "speed", "status"] as ResultField[]).some((f) => visibleFields.has(f));

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
    // Ranked finishers first (positions count only them), then DNS/DNF/DSQ apart
    // under their own divider — an out rider never takes or skips a position.
    const display = podiumMode ? active.slice(0, podSize) : [...active, ...out];
    // Gap is always relative to the actual #1 by place, independent of whatever
    // column the list is currently sorted by (name/bib/time) — not `active[0]`.
    const leader = active.length > 0
      ? [...active].sort((a, b) => a.lapsCounter !== b.lapsCounter
          ? b.lapsCounter - a.lapsCounter
          : riderElapsed(a) - riderElapsed(b))[0]
      : null;

    return (
      <div key={catKey} id={`results-cat-${catKey}`} className={styles.categoryBlock} data-testid="results-category">
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
            <React.Fragment key={rider.id}>
            {!podiumMode && isOut && idx === active.length && (
              <div className={styles.outDivider} data-testid="results-out-divider">Not classified</div>
            )}
            <div
              className={`${styles.row} ${isActive ? styles.active : ""} ${isOut ? styles.out : ""} ${podiumRowClass}`}
              onClick={() => setSelectedRider(rider)}
            >
              {/* Who: position, bib and the full name (wraps, never cut) */}
              <div className={styles.ident}>
                <span className={`${styles.pos} ${podiumMode && sortBy === "place" && !isOut && idx < 3 ? styles[`pos${idx + 1}`] : ""}`}>
                  {showMedal ? MEDAL[idx] : posLabel}
                </span>
                {visibleFields.has("bib") && <BibBadge className={styles.bib} rider={rider} />}
                <span className={styles.name} dir="auto">{rider.lastName} {rider.firstName}</span>
                {isAdministrativeFinish(rider) && (
                  <span className={styles.adminFinish} data-testid="admin-finish" title="Finished administratively when the wave was closed: no finish-line time was recorded">
                    Admin finish
                  </span>
                )}
              </div>
              {/* Every chosen field, labelled; they wrap onto more lines when the width runs out */}
              {hasFields && (
                <div className={styles.fields}>
                  {visibleFields.has("laps") && (
                    <span className={styles.field}><span className={styles.fieldLabel}>Laps</span><span className={styles.laps}>{rider.lapsCounter}/{rider.totalLaps}</span></span>
                  )}
                  {visibleFields.has("time") && (
                    <span className={styles.field}><span className={styles.fieldLabel}>Time</span><span className={styles.time}>{el && el !== Infinity ? fmtTime(el) : "—"}</span></span>
                  )}
                  {visibleFields.has("gap") && (
                    <span className={styles.field}><span className={styles.fieldLabel}>Gap</span><span className={styles.gap}>{isOut ? "—" : fmtGap(leader, rider)}</span></span>
                  )}
                  {visibleFields.has("speed") && (
                    <span className={styles.field}><span className={styles.fieldLabel}>Speed</span><span className={styles.speed}>{riderSpeedKph(rider)}</span></span>
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
              )}
            </div>
            </React.Fragment>
          );
        })}

        {podiumMode && out.length > 0 && (
          <div className={styles.outSummary}>
            {out.map((r) => (
              <span key={r.id} className={styles.outChip}>{r.status} {r.bibNumber}</span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const option = (selected: boolean, label: React.ReactNode, onPick: () => void, testId?: string) => (
    <button type="button" className={styles.optItem} aria-pressed={selected} onClick={onPick} data-testid={testId}>
      <span className={styles.optCheck}>{selected && <Check size={16} aria-hidden="true" />}</span>
      {label}
    </button>
  );

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.toolRow}>
          {/* Sort + category (+ wave) in one place, closed by default */}
          <div className={styles.fieldMenuWrap}>
            <button
              type="button"
              className={`${styles.iconBtn} ${filtersActive ? styles.iconBtnOn : ""}`}
              onClick={() => setShowFilterMenu((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={showFilterMenu}
              aria-label="Sort and filter"
              title="Sort and filter"
              data-testid="results-filter-btn"
            >
              <ListFilter size={18} aria-hidden="true" />
              {filtersActive && <span className={styles.iconDot} aria-hidden="true" />}
            </button>
            {showFilterMenu && (
              <>
                <div className={styles.fieldMenuOverlay} onClick={() => setShowFilterMenu(false)} />
                <div className={styles.filterMenu} role="dialog" aria-label="Sort and filter" data-testid="results-filter-menu">
                  <div className={styles.fieldMenuTitle}>Sort by</div>
                  {SORTS.map((s) => option(sortBy === s.key, s.label, () => setSortBy(s.key), `results-sort-${s.key}`))}
                  {waveNums.length > 1 && (
                    <>
                      <div className={`${styles.fieldMenuTitle} ${styles.menuSection}`}>Wave</div>
                      {option(waveFilter === "all", "All waves", () => pickWave("all"), "results-wave-all")}
                      {waveNums.map((w) => (
                        <React.Fragment key={w}>{option(waveFilter === w, `Wave ${w}`, () => pickWave(w), `results-wave-${w}`)}</React.Fragment>
                      ))}
                    </>
                  )}
                  <div className={`${styles.fieldMenuTitle} ${styles.menuSection}`}>Categories</div>
                  {option(filterCategory === "all", "All categories", () => setFilterCategory("all"), "results-cat-all")}
                  {waveCatKeys.map((k) => (
                    <React.Fragment key={k}>
                      {option(
                        filterCategory === k,
                        <><span className={styles.dot} style={{ background: catColor(k) }} /><span dir="auto">{catLabel(k)}</span></>,
                        () => setFilterCategory(k),
                        "results-cat-option"
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className={styles.groupBtns}>
            <button
              type="button"
              className={`${styles.groupBtn} ${groupBy === "category" ? styles.groupBtnActive : ""}`}
              aria-pressed={groupBy === "category"}
              onClick={() => setGroupBy("category")}
            >Cat</button>
            <button
              type="button"
              className={`${styles.groupBtn} ${groupBy === "wave" ? styles.groupBtnActive : ""}`}
              aria-pressed={groupBy === "wave"}
              onClick={() => setGroupBy("wave")}
            >Wave</button>
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
                aria-label="Columns"
              >
                <SlidersHorizontal size={15} aria-hidden="true" /> <span className={styles.btnLabel}>Columns</span>
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
              aria-label="Podium"
              aria-pressed={podiumMode}
              title="Podium"
            >
              <Trophy size={15} aria-hidden="true" /> <span className={styles.btnLabel}>Podium</span>
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={refresh}
              disabled={refreshing}
              aria-label="Refresh"
              title="Refresh"
              data-testid="results-refresh"
            >
              <RefreshCw size={16} aria-hidden="true" className={refreshing ? styles.spin : undefined} />
            </button>
          </div>
        </div>
      </div>

      {selectedRider && (
        <RiderDetailModal rider={selectedRider} onClose={() => setSelectedRider(null)}>
          {/* Lap-by-lap performance below the rider's details; the latest rider data, laps resolved */}
          <RiderLapTable rider={raceRiders.find((r) => r.id === selectedRider.id) ?? selectedRider} field={raceRiders} />
          <ResultCorrection raceUuid={raceUuid} rider={raceRiders.find((r) => r.id === selectedRider.id) ?? selectedRider} />
        </RiderDetailModal>
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
