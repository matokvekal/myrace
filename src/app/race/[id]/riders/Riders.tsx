import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { LayoutList, LayoutGrid, Layers, Play, Flag, Trash2, Pencil, Upload, Camera, ChevronDown } from "lucide-react";
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
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES, catWaveKey } from "../schedule/Schedule";

interface ManageHeatProps {
  raceUuid: string;
  categories: CategoryProps[];
  onEditMode?: () => void;
}

type SortKey = "name" | "bib" | "club" | "category" | "wave" | "status";

// Status ordering for the sortable Status column (active first, out last).
const STATUS_ORDER: Record<string, number> = {
  running: 0, standing: 1, finished: 2, DNF: 3, DNS: 4, DSQ: 5,
};
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
    const waveNum = catWaveMap.get(catWaveKey(cat.name, cat.subCategory));
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

const Riders: React.FC<ManageHeatProps> = ({ raceUuid, categories, onEditMode }) => {
  const previousRaceUuid = useRef<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [waveFilter, setWaveFilter] = useState<WaveFilter>("all");
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [importMode, setImportMode] = useState<"file" | "scan">("file");
  const [showDeleteRiders, setShowDeleteRiders] = useState(false);
  const [selectedRider, setSelectedRider] = useState<RiderProps | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Close the actions dropdown on outside click
  useEffect(() => {
    if (!actionsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [actionsOpen]);

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
      startMap.forEach((cats) => cats.forEach((cat) => map.set(catWaveKey(cat.name, cat.subCategory), waveNum)));
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
    if (activeHeat != null) list = list.filter((r) => catWaveMap.get(catWaveKey(r.category, r.subCategory)) === activeHeat);

    const waveOf = (r: RiderProps) =>
      catWaveMap.get(catWaveKey(r.category, r.subCategory)) ?? r.heat ?? Infinity;
    const byName = (a: RiderProps, b: RiderProps) =>
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);

    const sorted = [...list].sort((a, b) => {
      let base = 0;
      if (sortBy === "name") base = byName(a, b);
      else if (sortBy === "bib") base = a.bibNumber - b.bibNumber;
      else if (sortBy === "club") base = (a.team ?? "").localeCompare(b.team ?? "");
      else if (sortBy === "category") {
        base = a.category.localeCompare(b.category);
        if (base === 0) base = (a.subCategory ?? "").localeCompare(b.subCategory ?? "");
        if (base === 0) base = byName(a, b);
      } else if (sortBy === "wave") {
        base = waveOf(a) - waveOf(b);
        if (base === 0) base = a.bibNumber - b.bibNumber;
      } else if (sortBy === "status") {
        base = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
        if (base === 0) base = a.bibNumber - b.bibNumber;
      }
      return sortDir === "asc" ? base : -base;
    });
    return sorted;
  }, [riders, raceUuid, waveFilter, sortBy, sortDir, categories, catWaveMap]);

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(key); setSortDir("asc"); }
  };

  const sortArrow = (key: SortKey) => (sortBy === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

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
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className={styles.sortDropdown}
              aria-label="Sort riders"
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

          {/* Actions dropdown — Import / Scan / Edit */}
          <div className={styles.actionsMenu} ref={actionsRef}>
            <button
              type="button"
              className={styles.actionsTrigger}
              onClick={() => setActionsOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
            >
              <Pencil size={13} /> Actions
              <ChevronDown size={14} className={styles.actionsChevron} />
            </button>
            {actionsOpen && (
              <div className={styles.actionsList} role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className={styles.actionItem}
                  onClick={() => { setActionsOpen(false); setImportMode("file"); setShowImportWizard(true); }}
                >
                  <Upload size={15} /> Import CSV
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.actionItem}
                  onClick={() => { setActionsOpen(false); setImportMode("scan"); setShowImportWizard(true); }}
                >
                  <Camera size={15} /> Scan Start List
                </button>
                {onEditMode && (
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.actionItem}
                    onClick={() => { setActionsOpen(false); onEditMode(); }}
                  >
                    <Pencil size={15} /> Edit Riders
                  </button>
                )}
              </div>
            )}
          </div>
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
                <span className={styles.colBib} style={{ cursor: "pointer" }} onClick={() => handleSort("bib")} title="Sort by bib">Bib{sortArrow("bib")}</span>
                <span className={styles.colName} style={{ cursor: "pointer" }} onClick={() => handleSort("name")} title="Sort by name">Name{sortArrow("name")}</span>
                <span className={styles.colCat} style={{ cursor: "pointer" }} onClick={() => handleSort("category")} title="Sort by category">Category{sortArrow("category")}</span>
                <span className={styles.colWave} style={{ cursor: "pointer" }} onClick={() => handleSort("wave")} title="Sort by wave">Wave{sortArrow("wave")}</span>
                <span className={styles.colStatus} style={{ cursor: "pointer" }} onClick={() => handleSort("status")} title="Sort by status">Status{sortArrow("status")}</span>
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
                        <span className={styles.colWave}>{catWaveMap.get(catWaveKey(rider.category, rider.subCategory)) ?? rider.heat ?? "—"}</span>
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
