import React, { useState, useEffect, useCallback } from "react";
import styles from "./schedule.module.css";
import Button from "@/components/ui/Button";
import { useNavigate } from "react-router-dom";
import { CategoryProps } from "@/types/types";
import {
  Radio,
  Trophy,
  Edit2,
  Plus,
  Trash2,
  Save,
  X,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp
} from "lucide-react";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import { RiderProps } from "@/types/types";

interface Props {
  raceUuid: string;
  categories: CategoryProps[];
}

interface StartSlot {
  id: string;
  time: string;
  categoryIds: number[];
}

interface Wave {
  id: number;
  number: number;
  startTime: string;
  startSlots: StartSlot[];
}

export const DEFAULT_WAVE_GAP_MINUTES = 30;

export function normalizeTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export function toMinutes(t: string | null | undefined): number {
  const norm = normalizeTime(t);
  if (!norm) return Infinity;
  const [h, m] = norm.split(":").map(Number);
  return h * 60 + m;
}

export function buildSchedule(
  categories: CategoryProps[],
  waveGapMinutes = DEFAULT_WAVE_GAP_MINUTES
) {
  const sorted = [...categories].sort(
    (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)
  );

  const waveMap = new Map<number, Map<string, CategoryProps[]>>();
  let waveNum = 0;
  let lastStartMinutes = -Infinity;

  for (const cat of sorted) {
    const catMinutes = toMinutes(cat.startTime);
    const startKey = normalizeTime(cat.startTime) ?? "TBD";

    if (catMinutes - lastStartMinutes > waveGapMinutes) waveNum++;
    lastStartMinutes = catMinutes;

    if (!waveMap.has(waveNum)) waveMap.set(waveNum, new Map());
    const startMap = waveMap.get(waveNum)!;
    if (!startMap.has(startKey)) startMap.set(startKey, []);
    startMap.get(startKey)!.push(cat);
  }

  return waveMap;
}

const STATUS_COLOR: Record<string, string> = {
  running: "#3edda4",
  upcoming: "#63a6fc",
  finished: "#aaa"
};

const OUT_STATUSES = new Set(["DNS", "DSQ", "DNF"]);

function sortRidersForStanding(riderList: RiderProps[]): RiderProps[] {
  return [...riderList].sort((a, b) => a.bibNumber - b.bibNumber);
}

const Schedule: React.FC<Props> = ({ raceUuid, categories }) => {
  const navigate = useNavigate();
  const { updateCategory } = useCategoryStore();
  const { riders, getRiders, updateRider } = useRiderStore((s) => ({
    riders: s.riders,
    getRiders: s.getRiders,
    updateRider: s.updateRider
  }));

  const [editMode, setEditMode] = useState(false);
  const [waveGap, setWaveGap] = useState(DEFAULT_WAVE_GAP_MINUTES);
  const [waves, setWaves] = useState<Wave[]>([]);
  const [unassignedCategories, setUnassignedCategories] = useState<CategoryProps[]>([]);
  const [expandedCats, setExpandedCats] = useState<Set<number>>(new Set());

  const toggleCat = (catId: number) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const allCatIds = categories.map((c) => c.id);
  const allExpanded = allCatIds.length > 0 && allCatIds.every((id) => expandedCats.has(id));
  const toggleAllExpanded = () => {
    setExpandedCats(allExpanded ? new Set() : new Set(allCatIds));
  };

  useEffect(() => {
    getRiders(raceUuid);
  }, [raceUuid, getRiders]);

  const schedule = buildSchedule(categories, waveGap);

  const enterEditMode = () => {
    const waveData: Wave[] = [];
    const assigned = new Set<number>();

    schedule.forEach((startMap, waveNum) => {
      const slots: StartSlot[] = [];
      startMap.forEach((cats, startTime) => {
        slots.push({
          id: `slot-${waveNum}-${startTime}`,
          time: startTime === "TBD" ? "08:00" : startTime,
          categoryIds: cats.map((c) => { assigned.add(c.id); return c.id; })
        });
      });
      waveData.push({
        id: waveNum,
        number: waveNum,
        startTime: slots[0]?.time || "08:00",
        startSlots: slots
      });
    });

    setWaves(waveData);
    setUnassignedCategories(categories.filter((c) => !assigned.has(c.id)));
    setEditMode(true);
  };

  const addWave = () => {
    const maxWave = waves.length > 0 ? Math.max(...waves.map((w) => w.number)) : 0;
    setWaves([...waves, { id: Date.now(), number: maxWave + 1, startTime: "08:00", startSlots: [] }]);
  };

  const updateWaveTime = (waveId: number, time: string) => {
    setWaves(waves.map((w) => {
      if (w.id !== waveId) return w;
      return {
        ...w,
        startTime: time,
        startSlots: w.startSlots.map((s, i) => i === 0 ? { ...s, time } : s)
      };
    }));
  };

  const deleteWave = (waveId: number) => {
    const wave = waves.find((w) => w.id === waveId);
    if (!wave) return;
    const freed = wave.startSlots
      .flatMap((s) => s.categoryIds.map((id) => categories.find((c) => c.id === id)!))
      .filter(Boolean);
    setUnassignedCategories((prev) => [...prev, ...freed]);
    setWaves(waves.filter((w) => w.id !== waveId));
  };

  const moveWave = (waveId: number, direction: "up" | "down") => {
    const idx = waves.findIndex((w) => w.id === waveId);
    if (idx === -1) return;
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === waves.length - 1) return;
    const next = [...waves];
    const ti = direction === "up" ? idx - 1 : idx + 1;
    [next[idx], next[ti]] = [next[ti], next[idx]];
    setWaves(next);
  };

  const moveCategoryToWave = useCallback((cat: CategoryProps, targetWaveId: number | null) => {
    setUnassignedCategories((prev) => prev.filter((c) => c.id !== cat.id));
    setWaves((prev) => prev.map((w) => ({
      ...w,
      startSlots: w.startSlots.map((s) => ({
        ...s,
        categoryIds: s.categoryIds.filter((id) => id !== cat.id)
      }))
    })));

    if (targetWaveId === null) {
      setUnassignedCategories((prev) => [...prev, cat]);
    } else {
      setWaves((prev) => prev.map((w) => {
        if (w.id !== targetWaveId) return w;
        if (w.startSlots.length === 0) {
          return {
            ...w,
            startSlots: [{ id: `slot-${w.id}-${Date.now()}`, time: w.startTime, categoryIds: [cat.id] }]
          };
        }
        return {
          ...w,
          startSlots: w.startSlots.map((s, i) =>
            i === 0 ? { ...s, categoryIds: [...s.categoryIds, cat.id] } : s
          )
        };
      }));
    }
  }, []);

  const getCategoryWaveId = (catId: number): number | null => {
    for (const w of waves) {
      for (const s of w.startSlots) {
        if (s.categoryIds.includes(catId)) return w.id;
      }
    }
    return null;
  };

  const saveSchedule = async () => {
    for (const wave of waves) {
      for (const slot of wave.startSlots) {
        for (const catId of slot.categoryIds) {
          const category = categories.find((c) => c.id === catId);
          if (category) await updateCategory({ ...category, heat: wave.number, startTime: slot.time });
        }
      }
    }
    for (const cat of unassignedCategories) {
      await updateCategory({ ...cat, heat: 0, startTime: null });
    }
    setEditMode(false);
    setWaves([]);
    setUnassignedCategories([]);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setWaves([]);
    setUnassignedCategories([]);
  };

  if (!categories.length) {
    return <div className={styles.empty}>No categories yet. Import riders to generate them.</div>;
  }

  // ── EDIT MODE ──
  if (editMode) {
    const allEditCats: CategoryProps[] = [];
    waves.forEach((w) =>
      w.startSlots.forEach((s) =>
        s.categoryIds.forEach((id) => {
          const cat = categories.find((c) => c.id === id);
          if (cat && !allEditCats.find((c) => c.id === id)) allEditCats.push(cat);
        })
      )
    );
    unassignedCategories.forEach((cat) => {
      if (!allEditCats.find((c) => c.id === cat.id)) allEditCats.push(cat);
    });

    return (
      <div className={styles.container}>
        <div className={styles.editHeader}>
          <h3>Schedule Editor</h3>
          <div className={styles.editActions}>
            <Button variant="secondary" size="sm" onClick={cancelEdit}>
              <X size={14} /> Cancel
            </Button>
            <Button variant="success" size="sm" onClick={saveSchedule}>
              <Save size={14} /> Save Schedule
            </Button>
          </div>
        </div>

        {/* Waves */}
        <div className={styles.waveTimeSection}>
          <div className={styles.sectionHeader}>
            <span>Waves & Start Times</span>
            <Button variant="primary" size="sm" startIcon={<Plus size={12} />} onClick={addWave}>
              Add Wave
            </Button>
          </div>
          {waves.length === 0 ? (
            <div className={styles.emptyMessage}>No waves yet — click "Add Wave" to create one.</div>
          ) : (
            waves.map((wave, waveIdx) => (
              <div key={wave.id} className={styles.waveTimeRow}>
                <div className={styles.dragButtons}>
                  <button className={styles.iconBtn} onClick={() => moveWave(wave.id, "up")} disabled={waveIdx === 0} title="Move up">↑</button>
                  <button className={styles.iconBtn} onClick={() => moveWave(wave.id, "down")} disabled={waveIdx === waves.length - 1} title="Move down">↓</button>
                </div>
                <span className={styles.waveLabel}>Wave {wave.number}</span>
                <input
                  type="time"
                  className={styles.timeInput}
                  value={wave.startTime}
                  onChange={(e) => updateWaveTime(wave.id, e.target.value)}
                />
                <div style={{ marginLeft: "auto" }}>
                  <Button variant="icon" size="sm" iconOnly onClick={() => deleteWave(wave.id)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Category assignments */}
        <div className={styles.categoryAssignSection}>
          <div className={styles.sectionHeader}>
            <span>Category → Wave</span>
            <span className={styles.assignHint}>Choose a wave for each category</span>
          </div>
          {allEditCats.length === 0 ? (
            <div className={styles.emptyMessage}>No categories found. Import riders first.</div>
          ) : (
            allEditCats.map((cat) => {
              const currentWaveId = getCategoryWaveId(cat.id);
              return (
                <div key={cat.id} className={styles.categoryAssignRow}>
                  <div className={styles.colorDot} style={{ background: cat.color ?? "#ccc" }} />
                  <div className={styles.catAssignInfo}>
                    <span className={styles.catName}>{cat.name}</span>
                    {cat.subCategory && <span className={styles.subCategory}> · {cat.subCategory}</span>}
                    <span className={styles.riderCount}>{cat.riders ?? 0} riders</span>
                  </div>
                  <select
                    className={styles.waveSelect}
                    value={currentWaveId ?? ""}
                    onChange={(e) =>
                      moveCategoryToWave(cat, e.target.value !== "" ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">— Unassigned —</option>
                    {waves.map((w) => (
                      <option key={w.id} value={w.id}>Wave {w.number}  ·  {w.startTime}</option>
                    ))}
                  </select>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ── VIEW MODE ──
  return (
    <div className={styles.container}>
      <div className={styles.headerControls}>
        <button
          className={styles.expandAllBtn}
          onClick={toggleAllExpanded}
          title={allExpanded ? "Collapse all riders" : "Expand all riders"}
        >
          {allExpanded ? <ChevronsUp size={16} /> : <ChevronsDown size={16} />}
        </button>
        <label className={styles.gapLabel}>
          Wave gap
          <select
            className={styles.gapSelect}
            value={waveGap}
            onChange={(e) => setWaveGap(Number(e.target.value))}
          >
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={45}>45 min</option>
            <option value={60}>1 hour</option>
            <option value={90}>1.5 hrs</option>
          </select>
        </label>
        <Button variant="primary" size="sm" startIcon={<Edit2 size={14} />} onClick={enterEditMode}>
          Edit Schedule
        </Button>
      </div>

      {[...schedule.entries()].map(([waveNum, startMap]) => {
        const firstTime = [...startMap.keys()][0];
        const allWaveCats = [...startMap.values()].flat();
        const waveRiders = allWaveCats.flatMap((cat) =>
          riders.filter(
            (r) =>
              r.raceUuid === raceUuid &&
              r.category === cat.name &&
              (r.subCategory ?? null) === (cat.subCategory ?? null)
          )
        );
        const waveFinished = waveRiders.filter((r) => r.status === "finished").length;

        return (
          <div key={waveNum} className={styles.wave}>
            <div className={styles.waveHeader}>
              <span className={styles.waveLabel}>Wave {waveNum}</span>
              {firstTime !== "TBD" && <span className={styles.waveTime}>{firstTime}</span>}
              {waveRiders.length > 0 && (
                <span className={styles.waveStat}>{waveFinished}/{waveRiders.length} ✓</span>
              )}
              <Button
                variant="success"
                size="sm"
                className={styles.liveBtn}
                onClick={() => navigate(`/race/${raceUuid}/heat/${waveNum}`)}
              >
                <Radio size={13} /> Go Live
              </Button>
            </div>

            {[...startMap.entries()].map(([startTime, cats], si) => {
              const anyRunning = cats.some((c) => c.status === "running");
              const startRiders = cats.flatMap((cat) =>
                riders.filter(
                  (r) =>
                    r.raceUuid === raceUuid &&
                    r.category === cat.name &&
                    (r.subCategory ?? null) === (cat.subCategory ?? null)
                )
              );
              const startFinished = startRiders.filter((r) => r.status === "finished").length;

              return (
                <div key={startTime} className={styles.startGroup}>
                  <div className={styles.startHeader}>
                    <div className={styles.startInfo}>
                      <span>Start {si + 1}</span>
                      {si === 0 && firstTime !== "TBD" && (
                        <span className={styles.startTime}> · WAVE START: {firstTime}</span>
                      )}
                      {si > 0 && startTime !== "TBD" && (
                        <span className={styles.startTime}> · {startTime}</span>
                      )}
                      {startRiders.length > 0 && (
                        <span className={styles.startStat}>{startFinished}/{startRiders.length}</span>
                      )}
                    </div>
                    <div className={styles.startActions}>
                      {anyRunning && (
                        <Button variant="secondary" size="md" onClick={() => navigate(`/race/${raceUuid}/heat/${waveNum}`)}>
                          <Radio size={14} /> Live View
                        </Button>
                      )}
                    </div>
                  </div>

                  {cats.map((cat) => {
                    const catRiders = sortRidersForStanding(
                      riders.filter(
                        (r) =>
                          r.raceUuid === raceUuid &&
                          r.category === cat.name &&
                          (r.subCategory ?? null) === (cat.subCategory ?? null)
                      )
                    );

                    return (
                      <div key={cat.id} className={styles.catBlock}>
                        <div
                          className={styles.categoryRow}
                          onClick={() => catRiders.length > 0 && toggleCat(cat.id)}
                          style={{ cursor: catRiders.length > 0 ? "pointer" : "default" }}
                        >
                          <span className={styles.expandIcon}>
                            {catRiders.length > 0
                              ? expandedCats.has(cat.id)
                                ? <ChevronDown size={14} />
                                : <ChevronRight size={14} />
                              : <span style={{ width: 14 }} />
                            }
                          </span>
                          <div className={styles.colorDot} style={{ background: cat.color ?? "#ccc" }} />
                          <div className={styles.catInfo}>
                            <span className={styles.catName}>{cat.name}</span>
                            {cat.subCategory && (
                              <span className={styles.catMeta}> · {cat.subCategory}</span>
                            )}
                            <span className={styles.catMeta}>
                              {catRiders.length} riders · {cat.laps ?? 0} laps
                            </span>
                          </div>
                          <span
                            className={styles.statusBadge}
                            style={{ color: STATUS_COLOR[cat.status ?? "upcoming"] }}
                          >
                            {cat.status ?? "upcoming"}
                          </span>
                          <div className={styles.catActions} onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="secondary"
                              size="sm"
                              className={styles.standingsBtn}
                              onClick={() =>
                                navigate(`/race/${raceUuid}/standing/${waveNum}?category=${encodeURIComponent(cat.name)}`)
                              }
                            >
                              <Trophy size={12} />
                            </Button>
                          </div>
                        </div>

                        {(cat.laps ?? 0) > 0 && (() => {
                          const maxLaps = catRiders.length > 0
                            ? Math.max(0, ...catRiders.map((r) => r.lapsCounter || 0))
                            : 0;
                          return (
                            <div className={styles.lapBar}>
                              {Array.from({ length: cat.laps! }, (_, i) => (
                                <div
                                  key={i}
                                  className={`${styles.lapSegment} ${i < maxLaps ? styles.lapSegmentDone : ""}`}
                                />
                              ))}
                            </div>
                          );
                        })()}

                        {catRiders.length > 0 && expandedCats.has(cat.id) && (
                          <div className={styles.standingsList}>
                            {catRiders.map((rider, idx) => {
                              const isOut = OUT_STATUSES.has(rider.status ?? "");
                              const isDNS = rider.status === "DNS";
                              const isDNF = rider.status === "DNF";
                              const isDSQ = rider.status === "DSQ";
                              return (
                                <div
                                  key={rider.id}
                                  className={`${styles.standingRow} ${rider.checked ? styles.standingRowChecked : ""}`}
                                >
                                  <div
                                    className={styles.standingColorBar}
                                    style={{ background: rider.color ?? cat.color ?? "#ccc" }}
                                  />
                                  <span className={styles.standingPos}>{isOut ? "—" : idx + 1}</span>
                                  <span className={styles.standingBib}>#{rider.bibNumber}</span>
                                  <span className={styles.standingName}>
                                    {rider.lastName} {rider.firstName}
                                  </span>
                                  <span className={styles.standingLaps}>
                                    {rider.lapsCounter}/{rider.totalLaps}
                                  </span>
                                  <div className={styles.standingActions}>
                                    <button
                                      className={`${styles.vBtn} ${rider.checked ? styles.vBtnOn : ""}`}
                                      title={rider.checked ? "Uncheck" : "Check in"}
                                      onClick={() => updateRider({ ...rider, checked: !rider.checked })}
                                    >
                                      <Check size={11} />
                                    </button>
                                    <button
                                      className={`${styles.statusBtn} ${isDNS ? styles.dnsOn : ""}`}
                                      onClick={() =>
                                        updateRider({
                                          ...rider,
                                          status: isDNS ? "standing" : "DNS",
                                          raceStatus: "upcoming"
                                        })
                                      }
                                    >
                                      DNS
                                    </button>
                                    <button
                                      className={`${styles.statusBtn} ${isDNF ? styles.dnfOn : ""}`}
                                      onClick={() =>
                                        updateRider({
                                          ...rider,
                                          status: isDNF ? "standing" : "DNF",
                                          raceStatus: "upcoming"
                                        })
                                      }
                                    >
                                      DNF
                                    </button>
                                    <button
                                      className={`${styles.statusBtn} ${isDSQ ? styles.dsqOn : ""}`}
                                      onClick={() =>
                                        updateRider({ ...rider, status: isDSQ ? "running" : "DSQ" })
                                      }
                                    >
                                      DSQ
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}

      <button
        className={styles.scrollTopBtn}
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Back to top"
      >
        <ArrowUp size={18} />
      </button>
    </div>
  );
};

export default Schedule;
