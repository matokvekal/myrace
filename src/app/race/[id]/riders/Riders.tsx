import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { LayoutList, LayoutGrid, Layers, Play, Flag, Trash2 } from "lucide-react";
import styles from "./riders.module.css";
import Button from "@/components/ui/Button";
import useRiderStore from "@/stores/ridersStore";
import { CategoryProps, RiderProps } from "@/types/types";
import RiderCard from "../../components/riderCard/RiderCard";
import Icons from "@/constants/Icons";
import { shallow } from "zustand/shallow";
import { debounce } from "lodash";
import CSVImportWizard from "@/components/csv/CSVImportWizard";
import ScanDocumentButton from "@/components/importImage/ScanDocumentButton";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import RiderDetailModal from "../../components/riderDetailModal/RiderDetailModal";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES } from "../schedule/Schedule";

interface ManageHeatProps {
  raceUuid: string;
  categories: CategoryProps[];
}

type SortKey = "name" | "bib" | "club" | "category";
type WaveFilter = "all" | "now" | number;

function formatElapsed(now: Date, startTimeStr: string | null | undefined): string {
  if (!startTimeStr) return "--:--";
  const [h, m, s = 0] = startTimeStr.split(":").map(Number);
  const startMs = new Date(now);
  startMs.setHours(h, m, s, 0);
  const diffSec = Math.max(0, Math.floor((now.getTime() - startMs.getTime()) / 1000));
  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getNowWave(categories: CategoryProps[], catWaveMap: Map<string, number>): number | null {
  const now = new Date();
  const todayPrefix = now.toISOString().slice(0, 10);
  const waveTimeMap = new Map<number, Date>();
  categories.forEach((cat) => {
    const waveNum = catWaveMap.get(cat.name);
    if (waveNum == null || !cat.startTime) return;
    const dt = new Date(`${todayPrefix}T${cat.startTime}`);
    if (!waveTimeMap.has(waveNum) || dt < waveTimeMap.get(waveNum)!) {
      waveTimeMap.set(waveNum, dt);
    }
  });
  if (waveTimeMap.size === 0) return null;
  let closest: number | null = null;
  let minDiff = Infinity;
  waveTimeMap.forEach((dt, waveNum) => {
    const diff = Math.abs(dt.getTime() - now.getTime());
    if (diff < minDiff) { minDiff = diff; closest = waveNum; }
  });
  return closest;
}

const Riders: React.FC<ManageHeatProps> = ({ raceUuid, categories }) => {
  const previousRaceUuid = useRef<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [waveFilter, setWaveFilter] = useState<WaveFilter>("all");
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [importMode, setImportMode] = useState<"file" | "scan">("file");
  const [showDeleteRiders, setShowDeleteRiders] = useState(false);
  const [selectedRider, setSelectedRider] = useState<RiderProps | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { getRiders, riders, deleteRidersByRace } = useRiderStore(
    (state) => ({
      getRiders: state.getRiders,
      riders: state.riders,
      deleteRidersByRace: state.deleteRidersByRace
    }),
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

  // Derive wave numbers from the same buildSchedule algorithm as the Schedule tab
  const { waves, catWaveMap } = useMemo(() => {
    const schedule = buildSchedule(categories, DEFAULT_WAVE_GAP_MINUTES);
    const map = new Map<string, number>();
    schedule.forEach((startMap, waveNum) => {
      startMap.forEach((cats) => cats.forEach((cat) => map.set(cat.name, waveNum)));
    });
    return {
      waves: [...schedule.keys()].sort((a, b) => a - b),
      catWaveMap: map,
    };
  }, [categories]);

  const filteredAndSorted = useMemo(() => {
    const activeHeat =
      waveFilter === "now"
        ? getNowWave(categories, catWaveMap)
        : typeof waveFilter === "number"
          ? waveFilter
          : null;

    let list = riders.filter((r) => r.raceUuid === raceUuid);
    if (activeHeat != null) list = list.filter((r) => catWaveMap.get(r.category) === activeHeat);

    return [...list].sort((a, b) => {
      if (sortBy === "name")
        return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
      if (sortBy === "bib") return a.bibNumber - b.bibNumber;
      if (sortBy === "club") return (a.team ?? "").localeCompare(b.team ?? "");
      if (sortBy === "category") {
        const catCmp = a.category.localeCompare(b.category);
        if (catCmp !== 0) return catCmp;
        return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
      }
      return 0;
    });
  }, [riders, raceUuid, waveFilter, sortBy, categories, catWaveMap]);

  const grouped = useMemo((): Map<string, RiderProps[]> | null => {
    if (!groupByCategory) return null;
    const map = new Map<string, RiderProps[]>();
    filteredAndSorted.forEach((r) => {
      if (!map.has(r.category)) map.set(r.category, []);
      map.get(r.category)!.push(r);
    });
    return map;
  }, [filteredAndSorted, groupByCategory]);

  const sortOptions = [
    { key: "name" as SortKey, label: "Name A–Z" },
    { key: "bib" as SortKey, label: "Bib #" },
    { key: "club" as SortKey, label: "Club A–Z" },
    { key: "category" as SortKey, label: "Category" },
  ];

  return (
    <div className={styles.riders}>
      <div className={styles.topBar}>
        <div className={styles.leftControls}>
          {/* Sort dropdown */}
          <div className={styles.sortDropdownWrapper}>
            <label className={styles.sortLabel}>Sort:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className={styles.sortDropdown}
            >
              {sortOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* View mode buttons */}
          <div className={styles.viewModeGroup}>
            <button
              className={`${styles.viewModeBtn} ${viewMode === "table" ? styles.active : ""}`}
              onClick={() => setViewMode("table")}
              title="Table view"
            >
              <LayoutList size={16} />
            </button>
            <button
              className={`${styles.viewModeBtn} ${viewMode === "cards" && !groupByCategory ? styles.active : ""}`}
              onClick={() => { setViewMode("cards"); setGroupByCategory(false); }}
              title="Cards view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={`${styles.viewModeBtn} ${groupByCategory && viewMode === "cards" ? styles.active : ""}`}
              onClick={() => { setViewMode("cards"); setGroupByCategory((v) => !v); }}
              title="Group by category"
            >
              <Layers size={16} />
            </button>
          </div>

          {/* Import buttons */}
          <Button
            variant="secondary"
            size="sm"
            className={styles.importBtn}
            onClick={() => { setImportMode("file"); setShowImportWizard(true); }}
          >
            Import CSV
          </Button>
          <ScanDocumentButton
            variant="bar"
            onClick={() => { setImportMode("scan"); setShowImportWizard(true); }}
          />
        </div>
      </div>

      {(waves.length > 1 || riders.some((r) => r.raceUuid === raceUuid)) && (
        <div className={styles.filterBar}>
          {waves.length > 1 && (
            <div className={styles.waveFilterSection}>
              <label className={styles.waveLabel}>Wave:</label>
              <select
                value={typeof waveFilter === "number" ? waveFilter : waveFilter === "now" ? "now" : "all"}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "all") setWaveFilter("all");
                  else if (val === "now") setWaveFilter("now");
                  else setWaveFilter(parseInt(val, 10));
                }}
                className={styles.waveDropdown}
              >
                <option value="all">All Waves</option>
                {waves.map((w) => (
                  <option key={w} value={w}>
                    Wave {w}
                  </option>
                ))}
                <option value="now">NOW (Active)</option>
              </select>
            </div>
          )}

          {/* Delete All button - right side */}
          {riders.some((r) => r.raceUuid === raceUuid) && (
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.deleteBtn}`}
              onClick={() => setShowDeleteRiders(true)}
            >
              <Trash2 size={14} /> Delete All
            </Button>
          )}
        </div>
      )}

      {filteredAndSorted.length > 0 && (
        <div className={styles.tabCount}>
          Riders ({filteredAndSorted.length})
        </div>
      )}

      {filteredAndSorted.length > 0 ? (
        <>
          {viewMode === "table" ? (
            <div className={styles.dataTable}>
              <div className={styles.dataTableHeader}>
                <span className={styles.colRow}>#</span>
                <span className={styles.colDot} />
                <span className={styles.colFlag} />
                <span className={styles.colBib}>Bib</span>
                <span className={styles.colName}>Name</span>
                <span className={styles.colCat}>Category</span>
                <span className={styles.colWave}>Wave</span>
                <span className={styles.colStatus}>Status</span>
              </div>
              {(() => {
                let lastCat = "";
                let catIdx = 0;
                return filteredAndSorted.map((rider, idx) => {
                  const isOut = ["DNS","DNF","DSQ"].includes(rider.status);
                  const isRunning = rider.raceStatus === "running" && !isOut;
                  const isFinished = rider.raceStatus === "finished" && !isOut;
                  const showCatHeader = sortBy === "category" && rider.category !== lastCat;
                  if (showCatHeader) { lastCat = rider.category; catIdx = 0; } else { catIdx++; }
                  const catColor = categories.find((c) => c.name === rider.category)?.color ?? rider.color ?? "#ddd";
                  return (
                    <React.Fragment key={rider.id}>
                      {showCatHeader && (
                        <div className={styles.catSeparator} style={{ borderLeftColor: catColor }}>
                          <span className={styles.catSepDot} style={{ background: catColor }} />
                          {rider.category}
                        </div>
                      )}
                      <div
                        className={`${styles.dataRow} ${isRunning ? styles.rowRunning : ""} ${isOut ? styles.rowOut : ""}`}
                        onClick={() => setSelectedRider(rider)}
                      >
                        <span className={styles.colRow}>{idx + 1}</span>
                        <span className={styles.colDot} style={{ background: rider.color ?? "#ddd" }} />
                        <span className={styles.colFlag}>
                          <img
                            src={`/international/${rider.flag || "il"}.svg`}
                            alt={rider.flag || "il"}
                            className={styles.flagIcon}
                          />
                        </span>
                        <span className={styles.colBib}><strong>#{rider.bibNumber || "—"}</strong></span>
                        <span className={styles.colName} dir="auto">
                          {rider.lastName || rider.firstName
                            ? `${rider.lastName} ${rider.firstName}`.trim()
                            : "—"}
                        </span>
                        <span className={styles.colCat} dir="auto">
                          {rider.category || "—"}
                          {rider.subCategory && <span className={styles.subCatLabel}> · {rider.subCategory}</span>}
                        </span>
                        <span className={styles.colWave}>{catWaveMap.get(rider.category) ?? rider.heat ?? "—"}</span>
                        <span className={styles.colStatus}>
                          {isOut ? (
                            <span className={`${styles.statusTag} ${styles[rider.status.toLowerCase() + "Tag"]}`}>
                              {rider.status}
                            </span>
                          ) : isRunning ? (
                            <span className={styles.statusRunning}><Play size={11} fill="currentColor" /> {formatElapsed(currentTime, rider.timeStartRace)}</span>
                          ) : isFinished ? (
                            <span className={styles.statusFinished}><Flag size={14} /></span>
                          ) : null}
                        </span>
                      </div>
                    </React.Fragment>
                  );
                });
              })()}
            </div>
          ) : groupByCategory && grouped ? (
            [...grouped.entries()].map(([catName, catRiders]) => (
              <div key={catName} className={styles.catGroup}>
                <div className={styles.catGroupHeader}>{catName}</div>
                {catRiders.map((rider) => (
                  <div key={rider.id} onClick={() => setSelectedRider(rider)} style={{ cursor: "pointer" }}>
                    <RiderCard {...rider} />
                  </div>
                ))}
              </div>
            ))
          ) : (
            filteredAndSorted.map((rider) => (
              <div key={rider.id} onClick={() => setSelectedRider(rider)} style={{ cursor: "pointer" }}>
                <RiderCard {...rider} />
              </div>
            ))
          )}

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
        <div className={styles.emptyState}>
          <p className={styles.empty}>No riders yet.</p>
          <div className={styles.emptyActions}>
            <button
              className={styles.emptyImportBtn}
              onClick={() => { setImportMode("file"); setShowImportWizard(true); }}
            >
              Import CSV
            </button>
            <ScanDocumentButton
              variant="empty"
              onClick={() => { setImportMode("scan"); setShowImportWizard(true); }}
            />
          </div>
        </div>
      )}

      {showDeleteRiders && (
        <DeleteConfirmModal
          title="Delete All Riders"
          description="This will permanently remove all riders from this race, including all lap data. This cannot be undone."
          onConfirm={async () => {
            await deleteRidersByRace(raceUuid);
            setShowDeleteRiders(false);
          }}
          onCancel={() => setShowDeleteRiders(false)}
        />
      )}

      {selectedRider && (
        <RiderDetailModal
          rider={selectedRider}
          onClose={() => setSelectedRider(null)}
        />
      )}

      {showImportWizard && (
        <div className={styles.wizardOverlay}>
          <div className={styles.wizardModal}>
            <CSVImportWizard
              raceUuid={raceUuid}
              initialMode={importMode}
              onClose={() => setShowImportWizard(false)}
              onComplete={() => {
                setShowImportWizard(false);
                getRiders(raceUuid);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(Riders);
