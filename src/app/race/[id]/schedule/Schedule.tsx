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
import { getCategoryStatusInfo, getWaveStatusInfo } from "@/utils/statusChip";

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

// A category's identity is name + subCategory, NOT name alone — the same name
// (e.g. "Masters Men ") can exist in multiple waves with different sub-categories.
// Any map from category → wave MUST key by this composite, or waves collide.
export function catWaveKey(name: string, subCategory?: string | null): string {
  return `${name}::${subCategory ?? ""}`;
}

// True when a rider belongs to a category — matched by name AND subCategory, so a
// shared category name (e.g. "Masters Men " 19-29 vs 30-49) never pulls in riders
// from another start/wave. Use this everywhere riders are filtered by category.
export function riderInCategory(
  rider: { category: string; subCategory?: string | null },
  cat: { name: string; subCategory?: string | null }
): boolean {
  return rider.category === cat.name && (rider.subCategory ?? null) === (cat.subCategory ?? null);
}

/**
 * The category owns the lap count; a rider's own totalLaps is only a cache of
 * it. Riders imported without a laps column sit at 0, which not only displays
 * as "0/0" but stops them ever reaching the finish check (BUGS.md #7).
 * Resolve laps through here wherever they are shown or compared.
 */
export function effectiveTotalLaps(
  rider: { category: string; subCategory?: string | null; totalLaps: number },
  categories: { name: string; subCategory?: string | null; laps: number | null }[]
): number {
  const cat = categories.find((c) => riderInCategory(rider, c));
  return cat?.laps || rider.totalLaps || 0;
}

/** Riders with totalLaps resolved from their category. */
export function withCategoryLaps<
  T extends { category: string; subCategory?: string | null; totalLaps: number }
>(
  riders: T[],
  categories: { name: string; subCategory?: string | null; laps: number | null }[]
): T[] {
  return riders.map((rider) => {
    const laps = effectiveTotalLaps(rider, categories);
    return laps === rider.totalLaps ? rider : { ...rider, totalLaps: laps };
  });
}

export function normalizeTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const hhmm = `${m[1].padStart(2, "0")}:${m[2]}`;
  // Seconds are kept when non-zero: 08:22 and 08:22:30 are two separate starts
  // (a category released 30 s after the previous one), not the same slot.
  return m[3] && m[3] !== "00" ? `${hhmm}:${m[3]}` : hhmm;
}

/** Minutes since midnight; seconds count as a fraction (08:22:30 → 502.5). */
export function toMinutes(t: string | null | undefined): number {
  const norm = normalizeTime(t);
  if (!norm) return Infinity;
  const [h, m, s = 0] = norm.split(":").map(Number);
  return h * 60 + m + s / 60;
}

export function minutesToTime(mins: number): string {
  const clamped = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function buildSchedule(
  categories: CategoryProps[],
  waveGapMinutes = DEFAULT_WAVE_GAP_MINUTES
) {
  // Once categories have been assigned to explicit waves (via the Schedule
  // editor, which writes `heat`), that assignment is authoritative — group by
  // wave number so a wave shows even if its start time is close to another's.
  const hasExplicitWaves = categories.some((c) => Number(c.heat) > 0);

  if (hasExplicitWaves) {
    const waveMap = new Map<number, Map<string, CategoryProps[]>>();
    const addCat = (waveNum: number, cat: CategoryProps) => {
      const startKey = normalizeTime(cat.startTime) ?? "TBD";
      if (!waveMap.has(waveNum)) waveMap.set(waveNum, new Map());
      const startMap = waveMap.get(waveNum)!;
      if (!startMap.has(startKey)) startMap.set(startKey, []);
      startMap.get(startKey)!.push(cat);
    };

    // Assigned categories → grouped by their wave number
    const assigned = [...categories]
      .filter((c) => Number(c.heat) > 0)
      .sort((a, b) => {
        const dh = Number(a.heat) - Number(b.heat);
        return dh !== 0 ? dh : toMinutes(a.startTime) - toMinutes(b.startTime);
      });
    assigned.forEach((cat) => addCat(Number(cat.heat), cat));

    // Leftovers with a start time but no wave (e.g. imported after an edit)
    // → appended as time-derived waves after the last assigned wave.
    const maxHeat = assigned.reduce((m, c) => Math.max(m, Number(c.heat)), 0);
    const leftovers = [...categories]
      .filter((c) => !(Number(c.heat) > 0) && Number.isFinite(toMinutes(c.startTime)))
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    let waveNum = maxHeat;
    let lastStartMinutes = -Infinity;
    for (const cat of leftovers) {
      const catMinutes = toMinutes(cat.startTime);
      if (catMinutes - lastStartMinutes > waveGapMinutes) waveNum++;
      lastStartMinutes = catMinutes;
      addCat(waveNum, cat);
    }

    return waveMap;
  }

  // Fallback for unedited schedules: derive waves from start-time gaps.
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

export interface WaveStatusEntry {
  waveNum: number;
  status: "upcoming" | "running" | "finished" | "partial";
  startTime: string | null;
}

/** Every wave number in schedule order, each tagged with its aggregate status
 *  (same rule as getWaveStatusInfo) and first start time — for wave pickers. */
export function getScheduleWaves(
  categories: CategoryProps[],
  waveGapMinutes = DEFAULT_WAVE_GAP_MINUTES
): WaveStatusEntry[] {
  const schedule = buildSchedule(categories, waveGapMinutes);
  return [...schedule.keys()]
    .sort((a, b) => a - b)
    .map((waveNum) => {
      const startMap = schedule.get(waveNum)!;
      const cats = [...startMap.values()].flat();
      const firstTime = [...startMap.keys()][0] ?? null;
      let status: WaveStatusEntry["status"] = "upcoming";
      if (cats.length && cats.every((c) => c.status === "finished")) status = "finished";
      else if (cats.some((c) => c.status === "running")) status = "running";
      else if (cats.some((c) => c.status === "finished")) status = "partial";
      return { waveNum, status, startTime: firstTime === "TBD" ? null : firstTime };
    });
}

/**
 * Which wave the Live phase should open by default: the wave that's actually
 * running right now, or — once nothing is live (race not started yet, or
 * every wave already finished) — the first wave in the schedule. Never the
 * Start folder's `selectedWave`, which tracks whatever wave the commissaire
 * was last administering there and can be well behind (or ahead of) reality.
 */
export function getDefaultLiveWave(
  categories: CategoryProps[],
  waveGapMinutes = DEFAULT_WAVE_GAP_MINUTES
): number | null {
  const waves = getScheduleWaves(categories, waveGapMinutes);
  if (waves.length === 0) return null;
  return waves.find((w) => w.status === "running")?.waveNum ?? waves[0].waveNum;
}

const OUT_STATUSES = new Set(["DNS", "DSQ", "DNF"]);

// A wave is "locked" once it has started or finished — its start time can no
// longer be edited. "finished" = every category finished; "running" = at least
// one category running or finished (but not all finished yet).
type WaveLock = "running" | "finished" | null;

function getWaveLock(statuses: (string | null | undefined)[]): WaveLock {
  if (statuses.length && statuses.every((s) => s === "finished")) return "finished";
  if (statuses.some((s) => s === "running" || s === "finished")) return "running";
  return null;
}

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
  const [waves, setWaves] = useState<Wave[]>([]);
  const [unassignedCategories, setUnassignedCategories] = useState<CategoryProps[]>([]);
  const [expandedCats, setExpandedCats] = useState<Set<number>>(new Set());
  const [editLaps, setEditLaps] = useState(false);

  // Same write as Categories' updateCategoryAndSyncRiders: the category owns the
  // laps, and every rider in it gets the new total (laps || rider.totalLaps).
  const setCategoryLaps = async (cat: CategoryProps, laps: number) => {
    const next = Math.max(0, laps);
    if (next === (cat.laps ?? 0)) return;
    const updated = { ...cat, laps: next };
    await updateCategory(updated);
    for (const rider of riders.filter((r) => r.raceUuid === raceUuid && riderInCategory(r, cat))) {
      await updateRider({ ...rider, color: updated.color, totalLaps: updated.laps || rider.totalLaps });
    }
  };

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

  const schedule = buildSchedule(categories, DEFAULT_WAVE_GAP_MINUTES);

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
    // New wave starts 1.5 hours after the latest existing wave (default 08:00 if none)
    const times = waves.map((w) => toMinutes(w.startTime)).filter((n) => Number.isFinite(n));
    const startTime = times.length ? minutesToTime(Math.max(...times) + 90) : "08:00";
    setWaves([...waves, { id: Date.now(), number: maxWave + 1, startTime, startSlots: [] }]);
  };

  // Nudge a wave's start time by ±minutes (used by the −5 / +5 buttons)
  const nudgeWaveTime = (waveId: number, delta: number) => {
    const wave = waves.find((w) => w.id === waveId);
    if (!wave) return;
    const base = toMinutes(wave.startTime);
    const mins = Number.isFinite(base) ? base : toMinutes("08:00");
    updateWaveTime(waveId, minutesToTime(mins + delta));
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
            waves.map((wave, waveIdx) => {
              const waveLock = getWaveLock(
                wave.startSlots
                  .flatMap((s) => s.categoryIds)
                  .map((id) => categories.find((c) => c.id === id)?.status)
              );
              const locked = waveLock !== null;
              return (
                <div key={wave.id} className={styles.waveTimeRow} data-wave-lock={waveLock ?? undefined}>
                  <div className={styles.dragButtons}>
                    <button className={styles.iconBtn} onClick={() => moveWave(wave.id, "up")} disabled={waveIdx === 0} title="Move up">↑</button>
                    <button className={styles.iconBtn} onClick={() => moveWave(wave.id, "down")} disabled={waveIdx === waves.length - 1} title="Move down">↓</button>
                  </div>
                  <span className={styles.waveLabel}>Wave {wave.number}</span>
                  <button
                    className={styles.nudgeBtn}
                    onClick={() => nudgeWaveTime(wave.id, -5)}
                    disabled={locked}
                    title={locked ? "Time locked — wave already started" : "5 minutes earlier"}
                  >
                    −5
                  </button>
                  <input
                    type="time"
                    className={styles.timeInput}
                    value={wave.startTime}
                    onChange={(e) => updateWaveTime(wave.id, e.target.value)}
                    disabled={locked}
                    title={locked ? "Time locked — wave already started" : undefined}
                  />
                  <button
                    className={styles.nudgeBtn}
                    onClick={() => nudgeWaveTime(wave.id, 5)}
                    disabled={locked}
                    title={locked ? "Time locked — wave already started" : "5 minutes later"}
                  >
                    +5
                  </button>
                  {locked && (
                    <span className={styles.lockTag} data-wave-lock={waveLock}>
                      🔒 {waveLock === "finished" ? "Finished" : "Started"}
                    </span>
                  )}
                  <div style={{ marginLeft: "auto" }}>
                    <Button variant="icon" size="sm" iconOnly onClick={() => deleteWave(wave.id)}>
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              );
            })
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
        <Button
          variant={editLaps ? "primary" : "secondary"}
          size="sm"
          startIcon={editLaps ? <Check size={14} /> : <Edit2 size={14} />}
          onClick={() => setEditLaps((v) => !v)}
        >
          {editLaps ? "Done" : "Edit Laps"}
        </Button>
        <Button variant="secondary" size="sm" startIcon={<Edit2 size={14} />} onClick={enterEditMode}>
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
        const waveStatusInfo = getWaveStatusInfo(allWaveCats.map((c) => c.status));
        const waveLock = getWaveLock(allWaveCats.map((c) => c.status));

        return (
          <div key={waveNum} className={styles.wave}>
            <div className={styles.waveHeader} data-wave-lock={waveLock ?? undefined}>
              <span className={styles.waveLabel}>Wave {waveNum}</span>
              <span
                className={styles.statusBadge}
                style={{ background: `${waveStatusInfo.color}1f`, color: waveStatusInfo.color }}
              >
                {waveStatusInfo.label}
              </span>
              {firstTime !== "TBD" && <span className={styles.waveTime}>{firstTime}</span>}
              {waveRiders.length > 0 && (
                <span className={styles.waveStat} title="Finishers">🏁 {waveFinished}/{waveRiders.length}</span>
              )}
            </div>

            {[...startMap.entries()].map(([startTime, cats], si) => {
              const anyRunning = cats.some((c) => c.status === "running");
              const startLock = getWaveLock(cats.map((c) => c.status));
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
                  <div className={styles.startHeader} data-wave-running={anyRunning ? "true" : "false"} data-wave-lock={startLock ?? undefined}>
                    <div className={styles.startInfo}>
                      <span className={styles.startLabel}>Start {si + 1}</span>
                      {(si === 0 ? firstTime : startTime) !== "TBD" && (
                        <span className={styles.startTime}>{si === 0 ? firstTime : startTime}</span>
                      )}
                      {anyRunning && (
                        <button
                          className={styles.liveChipBtn}
                          onClick={() => navigate(`/race/${raceUuid}/heat/${waveNum}`)}
                          title="Open live view"
                        >
                          <Radio size={12} /> Live
                        </button>
                      )}
                      {startRiders.length > 0 && (
                        <span className={styles.startStat} title="Finishers">🏁 {startFinished}/{startRiders.length}</span>
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
                              {catRiders.length} riders
                            </span>
                            <span
                              className={`${styles.lapsEditor} ${(cat.laps ?? 0) > 0 ? "" : styles.lapsMissing} ${editLaps ? styles.lapsEditing : ""}`}
                              title={(cat.laps ?? 0) > 0 ? "Laps" : "Laps not set"}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {editLaps && (cat.laps ?? 0) > 0 && (
                                <button
                                  type="button"
                                  className={styles.lapsBtn}
                                  onClick={() => setCategoryLaps(cat, (cat.laps ?? 0) - 1)}
                                >−</button>
                              )}
                              <span className={styles.lapsValue}>{cat.laps ?? 0} laps</span>
                              {editLaps && (
                                <button
                                  type="button"
                                  className={styles.lapsBtn}
                                  onClick={() => setCategoryLaps(cat, (cat.laps ?? 0) + 1)}
                                >+</button>
                              )}
                            </span>
                          </div>
                          {(() => {
                            const info = getCategoryStatusInfo(cat.status);
                            return (
                              <span
                                className={styles.statusBadge}
                                style={{ background: `${info.color}1f`, color: info.color }}
                              >
                                {info.label}
                              </span>
                            );
                          })()}
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
