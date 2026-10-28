import React, { useState, useEffect, useCallback, useMemo } from "react";
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
  ChevronsUp,
  Palette,
  Lock,
  Users
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDataStore } from "@/stores/appStore";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import useRaceStore from "@/stores/racesStore";
import { RiderProps } from "@/types/types";
import { getCategoryStatusInfo, getWaveStatusInfo } from "@/utils/statusChip";
import { getCategoryLocks } from "@/utils/categoryLocks";
import { finishGroupLabel, finishGroupOptions } from "@/utils/finishGroups";
import { emptyPrefs, learnRace, suggestFinishGroups, type FinishGroupPrefs } from "@/utils/finishGroupLearning";
import { loadFinishGroupPrefs, saveFinishGroupPrefs } from "@/services/finishGroupPrefs";
import ColorSwatchPicker from "@/components/ui/ColorSwatchPicker";
import { withStatus } from "@/utils/riderStatus";
import RiderDetailModal from "../../components/riderDetailModal/RiderDetailModal";

interface Props {
  raceUuid: string;
  categories: CategoryProps[];
}

/** Schedule editor: a category in a wave, starting `gap` seconds after the previous one. */
interface WaveRow {
  catId: number;
  gap: number;
}

interface Wave {
  id: number;
  number: number;
  /** Wave base start time ("HH:MM" or "HH:MM:SS"): the first category's start. */
  base: string;
  rows: WaveRow[];
}

/** Default interval between consecutive category starts in a wave. */
const DEFAULT_START_GAP_SEC = 30;

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
  const { t } = useTranslation();
  const setActiveTab = useDataStore((s) => s.setActiveTab);
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
  const [selectedRider, setSelectedRider] = useState<{ rider: RiderProps; wave: number } | null>(null);
  const [colorCat, setColorCat] = useState<CategoryProps | null>(null);
  const [colorWholeGroup, setColorWholeGroup] = useState(false);
  const [colorDraft, setColorDraft] = useState("#63A6FC");
  const [colorWave, setColorWave] = useState<number | null>(null);
  const race = useRaceStore((s) => s.races.find((r) => r.uuid === raceUuid));
  const updateRace = useRaceStore((s) => s.updateRace);

  // A wave owns its own colour (race.waveColors), separate from its categories'.
  // Locked once every category in the wave has finished.
  const saveWaveColor = async (waveNum: number, color: string) => {
    if (!race) return;
    await updateRace({ ...race, waveColors: { ...(race.waveColors ?? {}), [String(waveNum)]: color } });
    setColorWave(null);
  };

  // Same write as Categories' updateCategoryAndSyncRiders: the category owns the
  // colour and every rider in it carries a copy. Finished categories are refused
  // here as well as in the UI.
  const saveCategoryColor = async (cat: CategoryProps, color: string) => {
    if (getCategoryLocks(cat, riders).color) return;
    // Optionally the same colour for every category of its Finish Group (locked ones keep theirs).
    const group = cat.linkGroup?.trim();
    const targets =
      colorWholeGroup && group
        ? useCategoryStore.getState().categories.filter((c) => c.raceUuid === raceUuid && c.linkGroup?.trim() === group && !getCategoryLocks(c, riders).color)
        : [cat];
    for (const target of targets) {
      await updateCategory({ ...target, color });
      for (const rider of riders.filter((r) => r.raceUuid === raceUuid && riderInCategory(r, target))) {
        await updateRider({ ...rider, color });
      }
    }
    setColorCat(null);
    setColorWholeGroup(false);
  };

  // Same write as Categories' updateCategoryAndSyncRiders: the category owns the
  // laps, and every rider in it gets the new total (laps || rider.totalLaps).
  const setCategoryLaps = async (cat: CategoryProps, laps: number) => {
    const next = Math.max(0, laps);
    if (next === (cat.laps ?? 0)) return;
    // Same race-safety rule as the category edit dialog: a finished category's
    // laps are fixed, and laps never drop below what a rider already rode.
    const locks = getCategoryLocks(cat, riders.filter((r) => r.raceUuid === raceUuid));
    if (locks.laps || next < locks.minLaps) return;
    const updated = { ...cat, laps: next };
    await updateCategory(updated);
    for (const rider of riders.filter((r) => r.raceUuid === raceUuid && riderInCategory(r, cat))) {
      await updateRider({ ...rider, color: updated.color, totalLaps: updated.laps || rider.totalLaps });
    }
  };

  // Finish Group = category.linkGroup (shared bell and finish, independent of the
  // wave). "" = None. Same category write as colour and laps, so it syncs the
  // same way. Fixed once the category has started.
  const setFinishGroup = async (cat: CategoryProps, value: string) => {
    if ((cat.status ?? "upcoming") !== "upcoming") return;
    if ((cat.linkGroup?.trim() ?? "") === value) return;
    await updateCategory({ ...cat, linkGroup: value });
    void rememberFinishGroups();
  };

  // Learned Finish Group suggestions (organizer's own past races; never by wave or name alone).
  const [fgPrefs, setFgPrefs] = useState<FinishGroupPrefs>(() => emptyPrefs());
  const [fgSuggestionsDismissed, setFgSuggestionsDismissed] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadFinishGroupPrefs().then((p) => alive && setFgPrefs(p));
    return () => { alive = false; };
  }, []);
  const fgSuggestions = useMemo(
    () => (fgSuggestionsDismissed ? new Map<number, string>() : suggestFinishGroups(fgPrefs, raceUuid, categories.filter((c) => c.raceUuid === raceUuid && (c.status ?? "upcoming") === "upcoming"))),
    [fgPrefs, fgSuggestionsDismissed, raceUuid, categories]
  );
  // Learn from deliberate assignments only (never from Reset All).
  const rememberFinishGroups = async () => {
    const next = learnRace(fgPrefs, raceUuid, useCategoryStore.getState().categories.filter((c) => c.raceUuid === raceUuid));
    setFgPrefs(next);
    await saveFinishGroupPrefs(next);
  };
  const acceptFinishGroupSuggestions = async () => {
    const all = useCategoryStore.getState().categories;
    for (const [id, value] of fgSuggestions) {
      const cat = all.find((c) => c.id === id);
      if (cat && !cat.linkGroup?.trim() && (cat.status ?? "upcoming") === "upcoming") await updateCategory({ ...cat, linkGroup: value });
    }
    await rememberFinishGroups();
  };

  // Ignore / Restore Wave: every category of the wave gets category.ignored —
  // same category write (and sync) as colour or laps. Nothing is deleted.
  const setWaveIgnored = async (waveNum: number, cats: CategoryProps[], riderCount: number, ignored: boolean) => {
    const n = cats.length;
    const what = `${n} categor${n === 1 ? "y" : "ies"} and ${riderCount} rider${riderCount === 1 ? "" : "s"}`;
    const msg = ignored
      ? `Ignore Wave ${waveNum}? Its ${what} are kept, but left out of starts, lap recording, positions and results. You can restore it later.`
      : `Restore Wave ${waveNum}? Its ${what} take part in the race again.`;
    if (!window.confirm(msg)) return;
    for (const c of cats) if (!!c.ignored !== ignored) await updateCategory({ ...c, ignored });
  };

  const resetFinishGroups = async () => {
    // From the store, not the prop: the latest assignments, including ones made a moment ago.
    const assigned = useCategoryStore
      .getState()
      .categories.filter((c) => c.raceUuid === raceUuid && c.linkGroup?.trim() && (c.status ?? "upcoming") === "upcoming");
    if (assigned.length === 0) return;
    if (!window.confirm(`Clear the Finish Group of ${assigned.length} categor${assigned.length === 1 ? "y" : "ies"}? Each will get its own bell and finish.`)) return;
    for (const cat of assigned) await updateCategory({ ...cat, linkGroup: "" });
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

  // Whether this race's riders have been loaded at least once, so the
  // "No riders" hint never flashes before IndexedDB answers.
  const [ridersLoaded, setRidersLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    setRidersLoaded(false);
    void getRiders(raceUuid).finally(() => alive && setRidersLoaded(true));
    return () => { alive = false; };
  }, [raceUuid, getRiders]);
  const noRiders = ridersLoaded && !riders.some((r) => r.raceUuid === raceUuid);

  const schedule = buildSchedule(categories, DEFAULT_WAVE_GAP_MINUTES);

  // ── Wave editor state ──
  // A wave is an ordered list of categories. The first starts at the wave's
  // base time; each next one starts `gap` seconds after the previous one.
  // Saved through the existing fields only: category.heat + category.startTime.
  const secOf = (t: string | null | undefined): number => {
    const n = normalizeTime(t);
    if (!n) return NaN;
    const [h, m, s = 0] = n.split(":").map(Number);
    return h * 3600 + m * 60 + s;
  };
  const fmtSec = (sec: number): string => {
    const c = ((Math.round(sec) % 86400) + 86400) % 86400;
    const pad = (n: number) => String(n).padStart(2, "0");
    return normalizeTime(`${pad(Math.floor(c / 3600))}:${pad(Math.floor((c % 3600) / 60))}:${pad(c % 60)}`)!;
  };
  /** Always HH:MM:SS, for <input type="time" step=1>. */
  const fullHms = (sec: number): string => {
    const c = Number.isFinite(sec) ? ((Math.round(sec) % 86400) + 86400) % 86400 : 8 * 3600;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(Math.floor(c / 3600))}:${pad(Math.floor((c % 3600) / 60))}:${pad(c % 60)}`;
  };
  const rowTimes = (w: Wave): number[] => {
    let t = secOf(w.base);
    return w.rows.map((r, i) => {
      if (i > 0) t += r.gap;
      return t;
    });
  };

  const enterEditMode = () => {
    const waveData: Wave[] = [];
    const assigned = new Set<number>();
    schedule.forEach((startMap, waveNum) => {
      const rows: WaveRow[] = [];
      let prev = NaN;
      let base = "";
      startMap.forEach((cats, startTime) => {
        const sec = startTime === "TBD" ? NaN : secOf(startTime);
        if (!base && Number.isFinite(sec)) base = startTime;
        cats.forEach((c, i) => {
          assigned.add(c.id);
          const gap = rows.length === 0 || i > 0 ? 0 : Number.isFinite(sec) && Number.isFinite(prev) ? sec - prev : DEFAULT_START_GAP_SEC;
          rows.push({ catId: c.id, gap });
        });
        if (Number.isFinite(sec)) prev = sec;
      });
      waveData.push({ id: waveNum, number: waveNum, base: base || "08:00", rows });
    });
    setWaves(waveData);
    setUnassignedCategories(categories.filter((c) => !assigned.has(c.id)));
    setEditMode(true);
  };

  const addWave = () => {
    const maxWave = waves.length > 0 ? Math.max(...waves.map((w) => w.number)) : 0;
    // New wave starts 1.5 hours after the latest existing wave (default 08:00 if none)
    const times = waves.map((w) => toMinutes(w.base)).filter((n) => Number.isFinite(n));
    const base = times.length ? minutesToTime(Math.max(...times) + 90) : "08:00";
    setWaves((prev) => [...prev, { id: Date.now(), number: maxWave + 1, base, rows: [] }]);
  };

  const patchWave = (waveId: number, fn: (w: Wave) => Wave) =>
    setWaves((prev) => prev.map((w) => (w.id === waveId ? fn(w) : w)));

  const setGap = (waveId: number, idx: number, gap: number) =>
    patchWave(waveId, (w) => ({ ...w, rows: w.rows.map((r, i) => (i === idx ? { ...r, gap: Math.max(0, gap) } : r)) }));

  // Reorder keeps each position's interval; only the categories swap.
  const moveRow = (waveId: number, idx: number, dir: -1 | 1) =>
    patchWave(waveId, (w) => {
      const j = idx + dir;
      if (j < 0 || j >= w.rows.length) return w;
      const rows = w.rows.map((r) => ({ ...r }));
      [rows[idx].catId, rows[j].catId] = [rows[j].catId, rows[idx].catId];
      return { ...w, rows };
    });

  const deleteWave = (waveId: number) => {
    const wave = waves.find((w) => w.id === waveId);
    if (!wave) return;
    const freed = wave.rows.map((r) => categories.find((c) => c.id === r.catId)).filter(Boolean) as CategoryProps[];
    setUnassignedCategories((prev) => [...prev, ...freed]);
    setWaves((prev) => prev.filter((w) => w.id !== waveId));
  };

  /** Move a category to a wave (appended, 30 s after the previous start) or back to unassigned. */
  const moveCategoryToWave = (catId: number, targetWaveId: number | null) => {
    const cat = categories.find((c) => c.id === catId);
    if (!cat) return;
    setUnassignedCategories((prev) => prev.filter((c) => c.id !== catId));
    setWaves((prev) =>
      prev
        .map((w) => ({ ...w, rows: w.rows.filter((r) => r.catId !== catId) }))
        .map((w) =>
          w.id === targetWaveId
            ? { ...w, rows: [...w.rows, { catId, gap: w.rows.length ? DEFAULT_START_GAP_SEC : 0 }] }
            : w
        )
    );
    if (targetWaveId === null) setUnassignedCategories((prev) => [...prev, cat]);
  };

  const saveSchedule = async () => {
    for (const wave of waves) {
      const times = rowTimes(wave);
      for (let i = 0; i < wave.rows.length; i++) {
        const category = categories.find((c) => c.id === wave.rows[i].catId);
        if (category) await updateCategory({ ...category, heat: wave.number, startTime: fmtSec(times[i]) });
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

  {/* New race: point to Riders, where riders are added or imported. Schedule stays usable below. */}
  const noRidersHint = noRiders ? (
    <div className={styles.emptyRiders} data-testid="schedule-no-riders" dir="auto">
      <Users className={styles.emptyRidersIcon} size={18} aria-hidden="true" />
      <div className={styles.emptyRidersText}>
        <div className={styles.emptyRidersTitle}>{t("schedule.noRidersTitle", "No riders added yet")}</div>
        <div className={styles.emptyRidersSub}>{t("schedule.noRidersSub", "Add riders to your race to get started.")}</div>
      </div>
      <Button variant="primary" size="sm" onClick={() => setActiveTab("riders")} data-testid="schedule-add-riders">
        {t("schedule.addRiders", "Add Riders")}
      </Button>
    </div>
  ) : null;

  // Nothing scheduled yet: just the Add Wave action (plus the riders hint for an empty race).
  if (!categories.length && !editMode) {
    return (
      <div className={styles.container}>
        {noRidersHint}
        <div className={styles.wvEmpty}>
          <button type="button" className={styles.wvPrimary} onClick={() => { enterEditMode(); addWave(); }} data-testid="schedule-add-wave">
            <Plus size={14} /> Add Wave
          </button>
        </div>
      </div>
    );
  }

  // ── EDIT MODE: one compact section per wave ──
  if (editMode) {
    return (
      <div className={styles.container}>
        <div className={styles.wvHeader}>
          <span className={styles.wvTitle}>Schedule</span>
          <button type="button" className={styles.wvSecondary} onClick={addWave} data-testid="schedule-add-wave">
            <Plus size={14} /> Add Wave
          </button>
          <div className={styles.wvHeaderEnd}>
            <button type="button" className={styles.wvSecondary} onClick={cancelEdit}>Cancel</button>
            <button type="button" className={styles.wvPrimary} onClick={() => void saveSchedule()} data-testid="schedule-save">
              <Save size={14} /> Save
            </button>
          </div>
        </div>

        {waves.length === 0 && <div className={styles.emptyMessage}>No waves. Add one to start scheduling.</div>}

        {waves.map((wave) => {
          const waveLock = getWaveLock(wave.rows.map((r) => categories.find((c) => c.id === r.catId)?.status));
          const locked = waveLock !== null;
          const times = rowTimes(wave);
          return (
            <section key={wave.id} className={styles.wv} data-wave-lock={waveLock ?? undefined}>
              <div className={styles.wvHead}>
                <span className={styles.wvName}>Wave {wave.number}</span>
                <label className={styles.wvBase}>
                  <span>Start</span>
                  <input
                    type="time"
                    step={1}
                    className={styles.wvTime}
                    value={fullHms(secOf(wave.base))}
                    disabled={locked}
                    onChange={(e) => e.target.value && patchWave(wave.id, (w) => ({ ...w, base: e.target.value }))}
                    aria-label={`Wave ${wave.number} start time`}
                  />
                </label>
                {locked && <span className={styles.lockTag} data-wave-lock={waveLock}>🔒 {waveLock === "finished" ? "Finished" : "Started"}</span>}
                <button
                  type="button"
                  className={`${styles.wvIcon} ${styles.wvDanger}`}
                  onClick={() => deleteWave(wave.id)}
                  disabled={locked}
                  aria-label={`Remove wave ${wave.number}`}
                  title="Remove wave (its categories become unassigned)"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {wave.rows.length === 0 ? (
                <div className={styles.wvNote}>Add categories to keep this wave.</div>
              ) : (
                <div className={styles.wvTable} role="table">
                  <div className={`${styles.wvRow} ${styles.wvRowHead}`} role="row">
                    <span>Category</span>
                    <span>Interval</span>
                    <span>Start</span>
                    <span />
                  </div>
                  {wave.rows.map((row, i) => {
                    const cat = categories.find((c) => c.id === row.catId);
                    if (!cat) return null;
                    return (
                      <div key={row.catId} className={styles.wvRow} role="row">
                        <span className={styles.wvCat} dir="auto">
                          <span className={styles.colorDot} style={{ background: cat.color ?? "#ccc" }} />
                          <span className={styles.wvCatName}>{cat.name}{cat.subCategory ? ` · ${cat.subCategory}` : ""}</span>
                        </span>
                        <span className={styles.wvGap}>
                          {i === 0 ? (
                            "—"
                          ) : (
                            <>
                              <input
                                type="number"
                                min={0}
                                step={5}
                                className={styles.wvGapInput}
                                value={row.gap}
                                disabled={locked}
                                onChange={(e) => setGap(wave.id, i, parseInt(e.target.value) || 0)}
                                aria-label={`Seconds after the previous start for ${cat.name}`}
                              />
                              <span className={styles.wvUnit}>s</span>
                            </>
                          )}
                        </span>
                        <span className={styles.wvStart}>{Number.isFinite(times[i]) ? fmtSec(times[i]) : "—"}</span>
                        <span className={styles.wvRowActions}>
                          <button type="button" className={styles.wvIcon} disabled={locked || i === 0} onClick={() => moveRow(wave.id, i, -1)} aria-label={`Move ${cat.name} up`}>↑</button>
                          <button type="button" className={styles.wvIcon} disabled={locked || i === wave.rows.length - 1} onClick={() => moveRow(wave.id, i, 1)} aria-label={`Move ${cat.name} down`}>↓</button>
                          <select
                            className={styles.wvMove}
                            value={wave.id}
                            disabled={locked}
                            onChange={(e) => moveCategoryToWave(cat.id, e.target.value === "" ? null : Number(e.target.value))}
                            aria-label={`Wave for ${cat.name}`}
                          >
                            {waves.map((w) => <option key={w.id} value={w.id}>W{w.number}</option>)}
                            <option value="">Remove</option>
                          </select>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {!locked && (
                <select
                  className={styles.wvAddCat}
                  value=""
                  disabled={unassignedCategories.length === 0}
                  onChange={(e) => e.target.value && moveCategoryToWave(Number(e.target.value), wave.id)}
                  aria-label={`Add a category to wave ${wave.number}`}
                  data-testid={`wave-add-category-${wave.number}`}
                >
                  <option value="">{unassignedCategories.length ? "+ Add Category" : "All categories are scheduled"}</option>
                  {unassignedCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.subCategory ? ` · ${c.subCategory}` : ""}</option>
                  ))}
                </select>
              )}
            </section>
          );
        })}

        {unassignedCategories.length > 0 && waves.length > 0 && (
          <div className={styles.wvNote}>
            Not scheduled: {unassignedCategories.map((c) => c.name).join(", ")}
          </div>
        )}

        {/* Finish Group helpers (the per-category Finish Group is on the schedule view) */}
        <div className={styles.wvFg}>
          <span>Finish groups</span>
          {fgSuggestions.size > 0 && (
            <>
              <button type="button" className={styles.wvSecondary} data-testid="finish-group-accept" onClick={() => void acceptFinishGroupSuggestions()}>
                Accept suggestions
              </button>
              <button type="button" className={styles.wvSecondary} data-testid="finish-group-dismiss" onClick={() => setFgSuggestionsDismissed(true)}>
                Dismiss
              </button>
            </>
          )}
          <button type="button" className={styles.wvSecondary} data-testid="finish-group-reset-all" onClick={() => void resetFinishGroups()}>
            Reset all
          </button>
        </div>
      </div>
    );
  }

  // ── VIEW MODE ──
  return (
    <div className={styles.container}>
      {noRidersHint}
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
        const waveIgnored = allWaveCats.length > 0 && allWaveCats.every((c) => c.ignored);

        return (
          <div key={waveNum} className={`${styles.wave} ${waveIgnored ? styles.waveIgnored : ""}`} data-testid={`schedule-wave-${waveNum}`}>
            <div
              className={styles.waveHeader}
              data-wave-lock={waveLock ?? undefined}
              style={race?.waveColors?.[String(waveNum)] ? { boxShadow: `inset 8px 0 0 ${race.waveColors[String(waveNum)]}` } : undefined}
            >
              <span className={styles.waveLabel}>Wave {waveNum}</span>
              <button
                type="button"
                className={styles.editColorBtn}
                data-testid={`edit-wave-color-${waveNum}`}
                disabled={waveLock === "finished"}
                aria-label={`Edit color of Wave ${waveNum}`}
                title={waveLock === "finished" ? "Color can't be changed — this wave has finished" : "Edit wave color"}
                onClick={() => { setColorDraft(race?.waveColors?.[String(waveNum)] ?? "#63A6FC"); setColorWave(waveNum); }}
              >
                {waveLock === "finished" ? <Lock size={12} /> : <Palette size={12} />}
              </button>
              {waveIgnored ? (
                <>
                  <span className={styles.ignoredBadge} data-testid={`wave-ignored-${waveNum}`}>Ignored</span>
                  <button
                    type="button"
                    className={styles.waveActionBtn}
                    data-testid={`restore-wave-${waveNum}`}
                    onClick={() => void setWaveIgnored(waveNum, allWaveCats, waveRiders.length, false)}
                  >
                    Restore Wave
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.waveActionBtn}
                  data-testid={`ignore-wave-${waveNum}`}
                  disabled={waveLock === "running"}
                  title={waveLock === "running" ? "A running wave can't be ignored" : "Set this wave aside: kept, but out of starts, laps, positions and results"}
                  onClick={() => void setWaveIgnored(waveNum, allWaveCats, waveRiders.length, true)}
                >
                  Ignore Wave
                </button>
              )}
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
                          {/* The colour bar itself opens the colour editor (same lock as the palette button) */}
                          {(() => {
                            const colorLocked = getCategoryLocks(cat, riders).color;
                            return (
                              <button
                                type="button"
                                className={styles.colorDotBtn}
                                data-testid={`color-dot-${cat.id}`}
                                disabled={colorLocked}
                                aria-label={`Edit color of ${cat.name}`}
                                title={colorLocked ? "Color can't be changed — this category has finished" : "Edit color"}
                                onClick={(e) => { e.stopPropagation(); setColorDraft(cat.color ?? "#63A6FC"); setColorCat(cat); }}
                              >
                                <span className={styles.colorDot} style={{ background: cat.color ?? "#ccc", display: "block" }} />
                              </button>
                            );
                          })()}
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
                            {(() => {
                              // Finish Group, right on the category row (same write as Edit Schedule).
                              const saved = cat.linkGroup?.trim() ?? "";
                              const suggested = !saved ? fgSuggestions.get(cat.id) : undefined;
                              const locked = (cat.status ?? "upcoming") !== "upcoming";
                              return (
                                <label className={styles.fgRow} title={locked ? "Fixed once the category has started" : "Categories in the same Finish Group share the bell and the finish, in any wave"}>
                                  <span className={styles.fgCaption}>Finish Group</span>
                                  <select
                                    className={`${styles.fgSelect} ${suggested ? styles.fgSelectSuggested : ""}`}
                                    aria-label={`Finish Group for ${cat.name}${cat.subCategory ? ` ${cat.subCategory}` : ""}`}
                                    data-testid={`finish-group-row-${cat.id}`}
                                    value={saved || suggested || ""}
                                    disabled={locked}
                                    onChange={(e) => void setFinishGroup(cat, e.target.value)}
                                  >
                                    {finishGroupOptions(categories.filter((c) => c.raceUuid === raceUuid)).map((v) => (
                                      <option key={v} value={v}>{finishGroupLabel(v)}</option>
                                    ))}
                                  </select>
                                  {suggested && <span className={styles.fgSuggested}>Suggested</span>}
                                </label>
                              );
                            })()}
                            {(() => {
                              const locks = getCategoryLocks(cat, riders);
                              return (
                                <button
                                  type="button"
                                  className={styles.editColorBtn}
                                  data-testid={`edit-color-${cat.id}`}
                                  disabled={locks.color}
                                  aria-label={`Edit color of ${cat.name}`}
                                  title={locks.color ? "Color can't be changed — this category has finished" : "Edit color"}
                                  onClick={() => { setColorDraft(cat.color ?? "#63A6FC"); setColorCat(cat); }}
                                >
                                  {locks.color ? <Lock size={12} /> : <Palette size={12} />}
                                </button>
                              );
                            })()}
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
                                  className={styles.standingRow}
                                >
                                  <div
                                    className={styles.standingColorBar}
                                    style={{ background: rider.color ?? cat.color ?? "#ccc" }}
                                  />
                                  <span className={styles.standingPos}>{isOut ? "—" : idx + 1}</span>
                                  <span className={styles.standingBib}>#{rider.bibNumber}</span>
                                  <button
                                    type="button"
                                    className={styles.standingName}
                                    dir="auto"
                                    title="Rider details"
                                    onClick={() => setSelectedRider({ rider, wave: waveNum })}
                                  >
                                    {`${rider.firstName ?? ""} ${rider.lastName ?? ""}`.trim() || "—"}
                                    {isOut && (
                                      <span className={`${styles.nameStatus} ${styles[`nameStatus${rider.status}`] ?? ""}`}>
                                        {rider.status}
                                      </span>
                                    )}
                                  </button>
                                  <span className={styles.standingLaps}>
                                    {rider.lapsCounter}/{rider.totalLaps}
                                  </span>
                                  <div className={styles.standingActions}>
                                    <button
                                      className={`${styles.statusBtn} ${isDNS ? styles.dnsOn : ""}`}
                                      onClick={() =>
                                        updateRider(withStatus(rider, isDNS ? "standing" : "DNS"))
                                      }
                                    >
                                      DNS
                                    </button>
                                    <button
                                      className={`${styles.statusBtn} ${isDNF ? styles.dnfOn : ""}`}
                                      onClick={() =>
                                        updateRider(withStatus(rider, isDNF ? "standing" : "DNF"))
                                      }
                                    >
                                      DNF
                                    </button>
                                    <button
                                      className={`${styles.statusBtn} ${isDSQ ? styles.dsqOn : ""}`}
                                      onClick={() =>
                                        updateRider(withStatus(rider, isDSQ ? "standing" : "DSQ"))
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

      {selectedRider && (
        <RiderDetailModal
          rider={riders.find((r) => r.id === selectedRider.rider.id) ?? selectedRider.rider}
          wave={selectedRider.wave}
          onClose={() => setSelectedRider(null)}
        />
      )}

      {colorWave != null && (
        <div className={styles.colorOverlay} onClick={() => setColorWave(null)}>
          <div className={styles.colorModal} role="dialog" aria-label="Edit wave color" onClick={(e) => e.stopPropagation()}>
            <div className={styles.colorTitle}>Color · Wave {colorWave}</div>
            <div className={styles.colorCurrent}>
              <span className={styles.colorSwatch} style={{ background: race?.waveColors?.[String(colorWave)] ?? "#ccc" }} />
              <span>Current {race?.waveColors?.[String(colorWave)] ?? "—"}</span>
            </div>
            <ColorSwatchPicker
              value={race?.waveColors?.[String(colorWave)]}
              onPick={(c) => void saveWaveColor(colorWave, c)}
              onCancel={() => setColorWave(null)}
              inputTestId="wave-color-input"
              saveTestId="wave-color-save"
            />
          </div>
        </div>
      )}

      {colorCat && (
        <div className={styles.colorOverlay} onClick={() => setColorCat(null)}>
          <div className={styles.colorModal} role="dialog" aria-label="Edit color" onClick={(e) => e.stopPropagation()}>
            <div className={styles.colorTitle}>Color · {colorCat.name}{colorCat.subCategory ? ` · ${colorCat.subCategory}` : ""}</div>
            <div className={styles.colorCurrent}>
              <span className={styles.colorSwatch} style={{ background: colorCat.color ?? "#ccc" }} />
              <span>Current {colorCat.color ?? "—"}</span>
            </div>
            {colorCat.linkGroup?.trim() && (
              <label className={styles.fgApplyAll}>
                <input
                  type="checkbox"
                  data-testid="color-whole-finish-group"
                  checked={colorWholeGroup}
                  onChange={(e) => setColorWholeGroup(e.target.checked)}
                />
                Apply to all categories in {finishGroupLabel(colorCat.linkGroup)}
              </label>
            )}
            <ColorSwatchPicker
              value={colorCat.color}
              onPick={(c) => void saveCategoryColor(colorCat, c)}
              onCancel={() => setColorCat(null)}
              inputTestId="color-input"
              saveTestId="color-save"
            />
          </div>
        </div>
      )}

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
