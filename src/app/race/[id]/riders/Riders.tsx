import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import BibBadge from "@/components/ui/BibBadge";
import { useTranslation } from "react-i18next";
import { LayoutList, LayoutGrid, Layers, Play, Flag, Trash2, Pencil, Upload, Plus, Search, X, ChevronDown, ChevronRight, ChevronsDown, ChevronsUp, Settings, UserRoundPlus } from "lucide-react";
import styles from "./riders.module.css";
import useRiderStore from "@/stores/ridersStore";
import useRaceStore from "@/stores/racesStore";
import { CategoryProps, RiderProps } from "@/types/types";
import RiderCard from "../../components/riderCard/RiderCard";
import RiderFlag from "../../components/riderFlag/RiderFlag";
import Icons from "@/constants/Icons";
import { shallow } from "zustand/shallow";
import { debounce } from "lodash";
import CSVImportWizard from "@/components/csv/CSVImportWizard";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import RiderDetailModal from "../../components/riderDetailModal/RiderDetailModal";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES, catWaveKey } from "../schedule/Schedule";
import QuickAddRider, { canAddRider } from "../raceMode/QuickAddRider";
import { matchesRiderSearch, groupRidersByWaveAndCategory } from "@/utils/riderList";

interface ManageHeatProps {
  raceUuid: string;
  categories: CategoryProps[];
  onEditMode?: () => void;
  /**
   * Finalized race — the start list is part of a signed result, so every way
   * of changing it (import, edit, delete-all) is removed. The stores reject
   * these writes anyway; hiding them keeps the screen honest.
   */
  readOnly?: boolean;
}

type SortKey = "name" | "bib" | "club" | "category" | "status";

// Status ordering for the sortable Status column (active first, out last).
const STATUS_ORDER: Record<string, number> = {
  running: 0, standing: 1, finished: 2, DNF: 3, DNS: 4, DSQ: 5,
};

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

const Riders: React.FC<ManageHeatProps> = ({ raceUuid, categories, onEditMode, readOnly = false }) => {
  const waveColors = useRaceStore((s) => s.races.find((r) => r.uuid === raceUuid)?.waveColors);
  const { t } = useTranslation();
  const previousRaceUuid = useRef<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [showAddRider, setShowAddRider] = useState(false);
  // Category the Add Rider form was opened from (preset, picker hidden); null = pick one.
  const [addFor, setAddFor] = useState<CategoryProps | null>(null);
  const openAddRider = (cat: CategoryProps | null) => { setAddFor(cat); setShowAddRider(true); };
  const canAdd = !readOnly && canAddRider(raceUuid);
  // Occasional actions (add, import, edit, delete) and view options live behind the gear.
  const [manageOpen, setManageOpen] = useState(false);
  const [importMode, setImportMode] = useState<"file" | "scan">("file");
  const [showDeleteRiders, setShowDeleteRiders] = useState(false);
  const [selectedRider, setSelectedRider] = useState<RiderProps | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  // Collapsed rider groups — display state only (never rider data, filters or
  // sorting). Empty on entry: every group expanded.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!manageOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setManageOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [manageOpen]);

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
    let list = riders.filter((r) => r.raceUuid === raceUuid);
    if (searchTerm.trim()) list = list.filter((r) => matchesRiderSearch(r, searchTerm));

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
      } else if (sortBy === "status") {
        base = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
        if (base === 0) base = a.bibNumber - b.bibNumber;
      }
      return sortDir === "asc" ? base : -base;
    });
    return sorted;
  }, [riders, raceUuid, sortBy, sortDir, searchTerm]);

  const hasRiders = riders.some((r) => r.raceUuid === raceUuid);
  const anyFlag = filteredAndSorted.some((r) => r.flag);

  const waveGroups = useMemo(
    () => groupRidersByWaveAndCategory(filteredAndSorted, categories),
    [filteredAndSorted, categories]
  );

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

  // Every group currently shown: category groups in the table, categories in "group by category".
  const groupKeys = useMemo((): string[] => {
    if (viewMode === "table") return waveGroups.flatMap((wg) => wg.categories.map((cg) => `t:${wg.wave ?? "none"}:${cg.key}`));
    if (grouped) return [...grouped.keys()].map((name) => `g:${name}`);
    return [];
  }, [viewMode, waveGroups, grouped]);
  // Global resets: they override every individual choice.
  const collapseAll = () => setCollapsedGroups(new Set(groupKeys));
  const expandAll = () => setCollapsedGroups(new Set());
  const allCollapsed = groupKeys.length > 0 && groupKeys.every((k) => collapsedGroups.has(k));
  /** Close the gear menu and run the action it offered. */
  const fromManage = (action: () => void) => () => { setManageOpen(false); action(); };

  /** "+" on a category header: add a rider straight into that category. */
  const catAddBtn = (cat: CategoryProps | undefined, name: string) =>
    !canAdd ? null : (
      <button
        type="button"
        className={styles.catAddBtn}
        aria-label={`Add rider to ${name}`}
        title={`Add rider to ${name}`}
        data-testid={`add-rider-${name}`}
        onClick={(e) => { e.stopPropagation(); openAddRider(cat ?? null); }}
      >
        <UserRoundPlus size={16} />
      </button>
    );

  const groupToggle = (key: string, label: string) => {
    const open = !collapsedGroups.has(key);
    return (
      <button
        type="button"
        className={styles.groupToggle}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
        title={open ? "Collapse" : "Expand"}
        onClick={(e) => { e.stopPropagation(); toggleGroup(key); }}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
    );
  };

  const sortOptions = [
    { key: "name" as SortKey, label: "Name A–Z" },
    { key: "bib" as SortKey, label: "Bib" },
    { key: "club" as SortKey, label: "Club A–Z" },
    { key: "category" as SortKey, label: "Category" },
  ];

  return (
    <div className={styles.riders}>
      {/* Always on screen: find a rider, see the list. Everything occasional is behind the gear. */}
      {hasRiders && (
        <div className={styles.topBar}>
          <div className={styles.searchBox}>
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              dir="auto"
              className={styles.searchInput}
              data-testid="rider-search"
              placeholder="Search name or bib"
              aria-label="Search riders"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button type="button" className={styles.searchClear} aria-label="Clear search" onClick={() => setSearchTerm("")}>
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="Manage riders"
            title="Manage riders"
            onClick={() => setManageOpen(true)}
            data-testid="rider-manage-btn"
          >
            <Settings size={17} />
          </button>
        </div>
      )}

      {filteredAndSorted.length > 0 && (
        <div className={styles.tabCount}>
          <span>Riders ({filteredAndSorted.length})</span>
          {groupKeys.length > 0 && (
            <button
              type="button"
              className={styles.groupBulkBtn}
              onClick={allCollapsed ? expandAll : collapseAll}
              data-testid={allCollapsed ? "expand-all" : "collapse-all"}
              aria-label={allCollapsed ? "Expand all" : "Collapse all"}
              title={allCollapsed ? "Expand all" : "Collapse all"}
            >
              {allCollapsed ? <ChevronsDown size={16} /> : <ChevronsUp size={16} />}
            </button>
          )}
        </div>
      )}

      {filteredAndSorted.length > 0 ? (
        <>
          {viewMode === "table" ? (
            <div className={styles.dataTable}>
              <div className={styles.dataTableHeader}>
                {anyFlag && <span className={styles.colFlag} />}
                <span className={styles.colBib} style={{ cursor: "pointer" }} onClick={() => handleSort("bib")} title="Sort by bib">Bib{sortArrow("bib")}</span>
                <span className={styles.colName} style={{ cursor: "pointer" }} onClick={() => handleSort("name")} title="Sort by name">Name{sortArrow("name")}</span>
                <span className={styles.colStatus} style={{ cursor: "pointer" }} onClick={() => handleSort("status")} title="Sort by status">Status{sortArrow("status")}</span>
              </div>
              {waveGroups.map((wg) => (
                <div key={wg.wave ?? "none"} className={styles.waveGroup} data-testid={`wave-group-${wg.wave ?? "none"}`}>
                  <div
                    className={styles.waveGroupHeader}
                    style={wg.wave != null && waveColors?.[String(wg.wave)] ? { borderLeft: `6px solid ${waveColors[String(wg.wave)]}` } : undefined}
                  >
                    {groupToggle(`w:${wg.wave ?? "none"}`, wg.wave != null ? `Wave ${wg.wave}` : "No wave")}
                    {wg.wave != null ? `Wave ${wg.wave}` : "No wave"}
                    <span className={styles.groupCount}>{wg.count}</span>
                  </div>
                  {!collapsedGroups.has(`w:${wg.wave ?? "none"}`) && wg.categories.map((cg) => {
                    const catColor = cg.category?.color ?? cg.riders[0]?.color ?? "#ddd";
                    const gKey = `t:${wg.wave ?? "none"}:${cg.key}`;
                    return (
                      <React.Fragment key={cg.key}>
                        <div className={styles.catSeparator} style={{ borderLeftColor: catColor }} data-testid="rider-category-header">
                          {groupToggle(gKey, cg.name)}
                          {cg.name}
                          <span className={styles.groupCount}>{cg.riders.length}</span>
                          {catAddBtn(cg.category ?? undefined, cg.name)}
                        </div>
                        {!collapsedGroups.has(gKey) && cg.riders.map((rider) => {
                          const isOut = ["DNS", "DNF", "DSQ"].includes(rider.status);
                          const isRunning = rider.raceStatus === "running" && !isOut;
                          const isFinished = rider.raceStatus === "finished" && !isOut;
                          return (
                            <div
                              key={rider.id}
                              className={`${styles.dataRow} ${isRunning ? styles.rowRunning : ""} ${isOut ? styles.rowOut : ""}`}
                              data-category={rider.category}
                              onClick={() => setSelectedRider(rider)}
                            >
                              {anyFlag && (
                                <span className={styles.colFlag}>
                                  <RiderFlag flag={rider.flag} className={styles.flagIcon} />
                                </span>
                              )}
                              <span className={styles.colBib}><strong><BibBadge rider={rider} category={cg.category ?? null} /></strong></span>
                              <span className={styles.colName} dir="auto">
                                {rider.lastName || rider.firstName
                                  ? `${rider.lastName} ${rider.firstName}`.trim()
                                  : "—"}
                              </span>
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
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : groupByCategory && grouped ? (
            [...grouped.entries()].map(([catName, catRiders]) => (
              <div key={catName} className={styles.catGroup}>
                <div className={styles.catGroupHeader} data-testid="rider-category-header">
                  {groupToggle(`g:${catName}`, catName)}
                  {catName}
                  <span className={styles.groupCount}>{catRiders.length}</span>
                  {catAddBtn(categories.find((c) => c.name === catName), catName)}
                </div>
                {!collapsedGroups.has(`g:${catName}`) && catRiders.map((rider) => (
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
      ) : hasRiders ? (
        <p className={styles.empty}>No riders match “{searchTerm.trim()}”.</p>
      ) : (
        <div className={styles.emptyState}>
          <p className={styles.empty}>No riders yet.</p>
          {canAdd && (
            <div className={styles.emptyActions}>
              <button
                className={styles.emptyImportBtn}
                data-testid="add-rider-btn"
                onClick={() => openAddRider(null)}
              >
                <Plus size={14} /> Add Rider
              </button>
              <button
                className={styles.emptyImportBtn}
                onClick={() => { setImportMode("file"); setShowImportWizard(true); }}
              >
                Import CSV
              </button>
            </div>
          )}
        </div>
      )}

      {manageOpen && (
        <div className={styles.wizardOverlay} onClick={() => setManageOpen(false)}>
          <div
            className={styles.manageModal}
            role="dialog"
            aria-modal="true"
            aria-label="Manage riders"
            onClick={(e) => e.stopPropagation()}
            data-testid="rider-manage-modal"
          >
            <div className={styles.manageHead}>
              <span>Manage riders</span>
              <button type="button" className={styles.iconBtn} aria-label="Close" onClick={() => setManageOpen(false)}>
                <X size={16} />
              </button>
            </div>

            {!readOnly && (
              <div className={styles.manageList}>
                {canAdd && (
                  <button type="button" className={styles.manageItem} data-testid="add-rider-btn" onClick={fromManage(() => openAddRider(null))}>
                    <Plus size={16} aria-hidden="true" /> Add rider
                  </button>
                )}
                <button type="button" className={styles.manageItem} onClick={fromManage(() => { setImportMode("file"); setShowImportWizard(true); })}>
                  <Upload size={16} aria-hidden="true" /> Import CSV
                </button>
                {onEditMode && (
                  <button type="button" className={styles.manageItem} onClick={fromManage(onEditMode)}>
                    <Pencil size={16} aria-hidden="true" /> Edit Riders
                  </button>
                )}
                <button type="button" className={`${styles.manageItem} ${styles.manageDanger}`} onClick={fromManage(() => setShowDeleteRiders(true))}>
                  <Trash2 size={16} aria-hidden="true" /> Delete All
                </button>
              </div>
            )}

            <div className={styles.manageLabel}>View</div>
            <div className={styles.viewModeGroup} role="group" aria-label="Riders view">
              <button
                type="button"
                className={`${styles.viewModeBtn} ${viewMode === "table" ? styles.active : ""}`}
                aria-pressed={viewMode === "table"}
                onClick={() => setViewMode("table")}
              >
                <LayoutList size={15} aria-hidden="true" /> Table
              </button>
              <button
                type="button"
                className={`${styles.viewModeBtn} ${viewMode === "cards" && !groupByCategory ? styles.active : ""}`}
                aria-pressed={viewMode === "cards" && !groupByCategory}
                onClick={() => { setViewMode("cards"); setGroupByCategory(false); }}
              >
                <LayoutGrid size={15} aria-hidden="true" /> Cards
              </button>
              <button
                type="button"
                className={`${styles.viewModeBtn} ${groupByCategory && viewMode === "cards" ? styles.active : ""}`}
                aria-pressed={groupByCategory && viewMode === "cards"}
                onClick={() => { setViewMode("cards"); setGroupByCategory(true); }}
              >
                <Layers size={15} aria-hidden="true" /> Category
              </button>
            </div>

            <label className={styles.manageLabel} htmlFor="riders-sort">Sort</label>
            <select
              id="riders-sort"
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

      {showAddRider && (
        <div className={styles.wizardOverlay} onClick={() => setShowAddRider(false)}>
          <div className={styles.addRiderModal} onClick={(e) => e.stopPropagation()} data-testid="add-rider-modal">
            <QuickAddRider
              raceUuid={raceUuid}
              waveNum={waves[0] ?? 1}
              waveOf={(c) => catWaveMap.get(catWaveKey(c.name, c.subCategory)) ?? waves[0] ?? 1}
              categories={categories}
              fixedCategory={addFor ?? undefined}
              essential
              onDone={() => setShowAddRider(false)}
            />
          </div>
        </div>
      )}

      {selectedRider && (
        <RiderDetailModal
          rider={selectedRider}
          wave={catWaveMap.get(catWaveKey(selectedRider.category, selectedRider.subCategory)) ?? null}
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
