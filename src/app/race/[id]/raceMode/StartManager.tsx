import React, { useState, useEffect, useRef } from "react";
import styles from "./startManager.module.css";
import { CategoryProps, RiderProps } from "@/types/types";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import useRaceStore from "@/stores/racesStore";
import Icons from "@/constants/Icons";
import Button from "@/components/ui/Button";
import { Plus, Edit2, GripVertical, X, Trash2, AlertTriangle, Play, Pause, Flag, ChevronUp, ChevronDown } from "lucide-react";
import { riderInCategory } from "../schedule/Schedule";

interface Props {
  raceUuid: string;
  waveNum: number;
  categories: CategoryProps[];
}

interface StartGroup {
  id: string;
  time: string;
  categoryIds: number[];
}

/** Normalize any time string to "HH:MM" for consistent grouping */
function normStartTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** Format seconds elapsed between now and a "HH:MM:SS" start string */
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

/** Group categories by startTime within a wave */
function groupByStart(cats: CategoryProps[]) {
  const map = new Map<string, CategoryProps[]>();
  for (const cat of [...cats].sort((a, b) => {
    const ta = normStartTime(a.startTime) ?? "";
    const tb = normStartTime(b.startTime) ?? "";
    return ta.localeCompare(tb);
  })) {
    const key = normStartTime(cat.startTime) ?? "TBD";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(cat);
  }
  return map;
}

interface CountdownProps {
  seconds: number;
  groupLabel: string;
  onDone: () => void;
  onStart: () => void;
  onCancel: () => void;
}

const Countdown: React.FC<CountdownProps> = ({ seconds: initial, groupLabel, onDone, onStart, onCancel }) => {
  const [remaining, setRemaining] = useState(initial);
  const [paused, setPaused] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (paused || remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, paused]);

  useEffect(() => {
    if (remaining <= 0) onDoneRef.current();
  }, [remaining]);

  const pct = Math.round((remaining / initial) * 100);
  const color = remaining <= 10 ? "#ff6b6b" : remaining <= 30 ? "#ffc107" : "#3edda4";

  return (
    <div className={`${styles.countdownBar} ${remaining <= 10 ? styles.countdownFinal : ""}`}>
      <div className={styles.countdownProgress} style={{ width: `${pct}%`, background: color }} />
      <div className={styles.countdownInner}>
        <div className={styles.countdownTimer}>
          {/* key={remaining} remounts the digit each second so the tick-pop replays */}
          <span key={remaining} className={styles.countdownNum} style={{ color }}>{remaining}</span>
          <span className={styles.countdownSec}>sec</span>
        </div>
        <span className={styles.countdownGroup}>{groupLabel}</span>
        <div className={styles.countdownBtns}>
          <button className={styles.countdownStartNow} onClick={() => { onStart(); onCancel(); }}>
            <Play size={14} fill="currentColor" /> Start Now
          </button>
          <button className={styles.countdownPauseBtn} onClick={() => setPaused((p) => !p)}>
            {paused ? <><Play size={14} fill="currentColor" /> Resume</> : <><Pause size={14} fill="currentColor" /> Pause</>}
          </button>
          <button className={styles.countdownCancelBtn} onClick={onCancel}>
            <X size={14} /> Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

interface ManageCategoriesModalProps {
  startGroup: StartGroup;
  allCategories: CategoryProps[];
  assignedCategoryIds: Set<number>;
  onClose: () => void;
  onSave: (categoryIds: number[]) => void;
}

const ManageCategoriesModal: React.FC<ManageCategoriesModalProps> = ({
  startGroup,
  allCategories,
  assignedCategoryIds,
  onClose,
  onSave
}) => {
  const [selectedIds, setSelectedIds] = useState<number[]>([
    ...startGroup.categoryIds
  ]);
  const [draggedCategory, setDraggedCategory] = useState<CategoryProps | null>(
    null
  );

  // Available categories: not assigned elsewhere OR already in this start group
  const availableCategories = allCategories.filter(
    (cat) =>
      !assignedCategoryIds.has(cat.id) ||
      startGroup.categoryIds.includes(cat.id)
  );

  const selectedCategories = selectedIds
    .map((id) => allCategories.find((c) => c.id === id))
    .filter(Boolean) as CategoryProps[];

  const unselectedCategories = availableCategories.filter(
    (cat) => !selectedIds.includes(cat.id)
  );

  const toggleCategory = (catId: number) => {
    setSelectedIds((prev) =>
      prev.includes(catId)
        ? prev.filter((id) => id !== catId)
        : [...prev, catId]
    );
  };

  const handleDragStart = (e: React.DragEvent, cat: CategoryProps) => {
    setDraggedCategory(cat);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDropOnSelected = () => {
    if (!draggedCategory) return;
    if (!selectedIds.includes(draggedCategory.id)) {
      setSelectedIds([...selectedIds, draggedCategory.id]);
    }
    setDraggedCategory(null);
  };

  const handleDropOnAvailable = () => {
    if (!draggedCategory) return;
    setSelectedIds(selectedIds.filter((id) => id !== draggedCategory.id));
    setDraggedCategory(null);
  };

  const removeCategory = (catId: number) => {
    setSelectedIds(selectedIds.filter((id) => id !== catId));
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>Manage Categories</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.categoriesPanel}>
            <div className={styles.panelHeader}>
              <span>Available Categories</span>
              <span className={styles.count}>
                {unselectedCategories.length}
              </span>
            </div>
            <div
              className={styles.categoryList}
              onDragOver={handleDragOver}
              onDrop={handleDropOnAvailable}
            >
              {unselectedCategories.length === 0 ? (
                <div className={styles.emptyMessage}>
                  All categories assigned
                </div>
              ) : (
                unselectedCategories.map((cat) => (
                  <div
                    key={cat.id}
                    className={styles.categoryItem}
                    draggable
                    onDragStart={(e) => handleDragStart(e, cat)}
                    onClick={() => toggleCategory(cat.id)}
                  >
                    <GripVertical size={14} className={styles.dragHandle} />
                    <div
                      className={styles.colorDot}
                      style={{ background: cat.color ?? "#ccc" }}
                    />
                    <span className={styles.catName}>{cat.name}</span>
                    {cat.subCategory && (
                      <span className={styles.subCategory}>
                        {" "}
                        · {cat.subCategory}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={styles.categoriesPanel}>
            <div className={styles.panelHeader}>
              <span>Selected for This Start</span>
              <span className={styles.count}>{selectedIds.length}</span>
            </div>
            <div
              className={styles.categoryList}
              onDragOver={handleDragOver}
              onDrop={handleDropOnSelected}
            >
              {selectedCategories.length === 0 ? (
                <div className={styles.emptyMessage}>
                  Drag categories here or click to add
                </div>
              ) : (
                selectedCategories.map((cat) => (
                  <div
                    key={cat.id}
                    className={`${styles.categoryItem} ${styles.selected}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, cat)}
                  >
                    <GripVertical size={14} className={styles.dragHandle} />
                    <div
                      className={styles.colorDot}
                      style={{ background: cat.color ?? "#ccc" }}
                    />
                    <span className={styles.catName}>{cat.name}</span>
                    {cat.subCategory && (
                      <span className={styles.subCategory}>
                        {" "}
                        · {cat.subCategory}
                      </span>
                    )}
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeCategory(cat.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className={styles.modalFooter}>
          <Button variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="success"
            size="md"
            onClick={() => {
              onSave(selectedIds);
              onClose();
            }}
          >
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
};

const StartManager: React.FC<Props> = ({ raceUuid, waveNum, categories }) => {
  const { updateCategory, categories: allCategories } = useCategoryStore();
  const { riders, updateAllRiders } = useRiderStore();
  const { races, updateRace } = useRaceStore();

  // This wave has begun once at least one of its categories is running or finished.
  // Rule: once begun, the wave's start time can no longer be adjusted.
  const waveHasStarted = categories.some(
    (c) => c.status === "running" || c.status === "finished"
  );

  // The wave is closed once every category is finished: no new start groups,
  // and the wave pill up top shows its "finished" stripes.
  const waveFinished =
    categories.length > 0 && categories.every((c) => c.status === "finished");

  // Rule: only one wave may run at a time. If any category OUTSIDE this wave is
  // running, this wave cannot be started until that one finishes.
  const thisWaveIds = new Set(categories.map((c) => c.id));
  const otherWaveRunning = allCategories.some(
    (c) => c.raceUuid === raceUuid && !thisWaveIds.has(c.id) && c.status === "running"
  );
  const [countdown, setCountdown] = useState<{ groupId: string; seconds: number } | null>(null);
const [editingStartId, setEditingStartId] = useState<string | null>(null);
  const [startGroups, setStartGroups] = useState<StartGroup[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [waveBaseTime, setWaveBaseTime] = useState<string>("");
  const [confirmFinishId, setConfirmFinishId] = useState<string | null>(null);
  const [confirmFinishWave, setConfirmFinishWave] = useState(false);
  const [expandedFinished, setExpandedFinished] = useState<Set<string>>(new Set());
  const [startError, setStartError] = useState<string[] | null>(null);

  // Update current time every second
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Initialize start groups from categories and calculate wave base time
  useEffect(() => {
    const grouped = groupByStart(categories);
    const groups: StartGroup[] = [];
    let idx = 0;
    let firstTime: string | null = null;

    grouped.forEach((cats, time) => {
      const timeStr = time === "TBD" ? "" : time;
      if (!firstTime && timeStr) firstTime = timeStr;

      groups.push({
        id: `start-${idx}`,
        time: timeStr,
        categoryIds: cats.map((c) => c.id)
      });
      idx++;
    });

    setStartGroups(groups);
    if (firstTime) {
      setWaveBaseTime(firstTime);
    } else {
      // Default to current time if no times set
      const now = new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
      setWaveBaseTime(now);
    }
  }, [categories]);

  // Parse time string to Date object
  const parseTime = (timeStr: string): Date => {
    const [hours, minutes, secs = 0] = timeStr.split(":").map(Number);
    const date = new Date();
    date.setHours(hours, minutes, secs, 0);
    return date;
  };

  // Calculate offset in seconds between two time strings
  const getTimeOffset = (baseTime: string, targetTime: string): number => {
    if (!baseTime || !targetTime) return 0;
    const base = parseTime(baseTime);
    const target = parseTime(targetTime);
    return Math.floor((target.getTime() - base.getTime()) / 1000);
  };

  // Apply offset to a time
  const applyOffset = (baseTime: string, offsetSeconds: number): string => {
    const date = parseTime(baseTime);
    date.setSeconds(date.getSeconds() + offsetSeconds);
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  };

  // Adjust wave time and cascade to all starts
  const adjustWaveTime = (seconds: number) => {
    // Calculate offsets for all starts relative to current wave time
    const offsets = startGroups.map((g) => ({
      id: g.id,
      offset: g.time ? getTimeOffset(waveBaseTime, g.time) : 0
    }));

    // Adjust wave base time
    const newWaveTime = applyOffset(waveBaseTime, seconds);
    setWaveBaseTime(newWaveTime);

    // Apply offsets to new wave time for all starts
    setStartGroups((prev) =>
      prev.map((g) => {
        const offset = offsets.find((o) => o.id === g.id)?.offset || 0;
        return {
          ...g,
          time: applyOffset(newWaveTime, offset)
        };
      })
    );
  };

  // Set wave time to now and cascade
  const setWaveTimeToNow = () => {
    const offsets = startGroups.map((g) => ({
      id: g.id,
      offset: g.time ? getTimeOffset(waveBaseTime, g.time) : 0
    }));

    const now = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    setWaveBaseTime(now);

    setStartGroups((prev) =>
      prev.map((g) => {
        const offset = offsets.find((o) => o.id === g.id)?.offset || 0;
        return {
          ...g,
          time: applyOffset(now, offset)
        };
      })
    );
  };

  // Update wave numbers in categories when wave time changes
  const updateWaveNumbersInCategories = async (newWaveTime: string) => {
    // Get all waves from all categories
    const allCats = await useCategoryStore.getState().getCategories(raceUuid);
    const waves = [...new Set(allCats.map((c) => c.heat ?? 0))].sort(
      (a, b) => a - b
    );

    // Get the first start time for each wave
    const waveTimesMap = new Map<number, string>();
    waves.forEach((waveNum) => {
      const waveCats = allCats.filter((c) => (c.heat ?? 0) === waveNum);
      const times = waveCats
        .map((c) => c.startTime)
        .filter(Boolean) as string[];
      if (times.length > 0) {
        // Get earliest time for this wave
        const sortedTimes = times.sort();
        waveTimesMap.set(waveNum, sortedTimes[0]);
      }
    });

    // If current wave time changed, check if reordering is needed
    waveTimesMap.set(waveNum, newWaveTime);

    // Sort waves by their start times
    const sortedWaves = Array.from(waveTimesMap.entries())
      .sort((a, b) => {
        if (!a[1]) return 1;
        if (!b[1]) return -1;
        return a[1].localeCompare(b[1]);
      })
      .map(([num]) => num);

    // Create mapping of old wave numbers to new wave numbers
    const waveMapping = new Map<number, number>();
    sortedWaves.forEach((oldNum, index) => {
      waveMapping.set(oldNum, index + 1);
    });

    // Check if current wave number needs to change
    const newWaveNum = waveMapping.get(waveNum);
    if (newWaveNum && newWaveNum !== waveNum) {
      // Update all categories in this wave with new wave number
      const waveCats = allCats.filter((c) => (c.heat ?? 0) === waveNum);
      for (const cat of waveCats) {
        await updateCategory({ ...cat, heat: newWaveNum });
      }
    }
  };

  const validateGroup = (group: StartGroup): string[] => {
    const errors: string[] = [];
    const cats = group.categoryIds
      .map((id) => categories.find((c) => c.id === id))
      .filter(Boolean) as CategoryProps[];

    if (cats.length === 0) {
      errors.push("No categories assigned to this start group");
      return errors;
    }

    for (const cat of cats) {
      if (!cat.laps || cat.laps <= 0) {
        errors.push(`"${cat.name}": no laps configured`);
      }
      const catRiders = riders.filter(
        (r) => riderInCategory(r, cat) && r.raceUuid === raceUuid && r.status !== "DNS"
      );
      if (catRiders.length === 0) {
        errors.push(`"${cat.name}": no riders assigned`);
      } else {
        const unchecked = catRiders.filter(
          (r) => !r.checked && !["DNS", "DNF", "DSQ"].includes(r.status)
        );
        if (unchecked.length > 0) {
          errors.push(
            `"${cat.name}": ${unchecked.length} rider${unchecked.length > 1 ? "s" : ""} not checked in`
          );
        }
      }
    }
    return errors;
  };

  const getCatIssues = (cat: CategoryProps): string[] => {
    const issues: string[] = [];
    if (!cat.laps || cat.laps <= 0) issues.push("No laps configured");
    const catRiders = riders.filter(
      (r) => riderInCategory(r, cat) && r.raceUuid === raceUuid && r.status !== "DNS"
    );
    if (catRiders.length === 0) {
      issues.push("No riders assigned");
    } else {
      const unchecked = catRiders.filter(
        (r) => !r.checked && !["DNS", "DNF", "DSQ"].includes(r.status)
      );
      if (unchecked.length > 0)
        issues.push(`${unchecked.length} rider${unchecked.length > 1 ? "s" : ""} not checked in`);
    }
    return issues;
  };

  const startGroup = async (group: StartGroup) => {
    // Only one wave may run at a time.
    if (otherWaveRunning) {
      setStartError(["Another wave is still running — finish it before starting this wave."]);
      return;
    }
    const errors = validateGroup(group);
    if (errors.length > 0) {
      setStartError(errors);
      return;
    }

    const now = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    const race = races.find((r) => r.uuid === raceUuid);
    if (race) await updateRace({ ...race, status: "running" });

    const cats = group.categoryIds
      .map((id) => categories.find((c) => c.id === id))
      .filter(Boolean) as CategoryProps[];

    const allUpdatedRiders: RiderProps[] = [];

    // Clear the track from the previous wave: any rider whose category already
    // finished but who is still "running" (was on the road when the race ended)
    // is finalized now, so starting a new wave leaves no ghosts behind on Live.
    riders
      .filter((r) => r.raceUuid === raceUuid && r.raceStatus === "running")
      .forEach((r) => {
        const cat = allCategories.find((c) => c.raceUuid === raceUuid && riderInCategory(r, c));
        if (cat?.status === "finished") {
          const isOut = ["DNF", "DSQ", "DNS"].includes(r.status);
          allUpdatedRiders.push({
            ...r,
            raceStatus: "finished" as const,
            status: isOut ? r.status : ("finished" as const),
          });
        }
      });

    for (const cat of cats) {
      if (cat.status !== "upcoming") continue;
      const catRiders = riders.filter(
        (r) =>
          riderInCategory(r, cat) &&
          r.raceUuid === raceUuid &&
          r.status !== "DNS"
      );
      await updateCategory({
        ...cat,
        status: "running" as const,
        lapsCounter: 0,
        riders: catRiders.length,
      });
      catRiders.forEach((r, i) => {
        allUpdatedRiders.push({
          ...r,
          raceStatus: "running" as const,
          timeStartRace: now,
          lapsCounter: 0,
          viewOrder: r.position_start ?? i + 1,
        });
      });
    }

    if (allUpdatedRiders.length > 0) {
      await updateAllRiders(allUpdatedRiders);
    }
  };

  const endRace = async (group: StartGroup) => {
    const now = new Date();
    if (countdown?.groupId === group.id) setCountdown(null);

    const cats = group.categoryIds
      .map((id) => categories.find((c) => c.id === id))
      .filter(Boolean) as CategoryProps[];

    for (const cat of cats) {
      // Never-started categories have nothing to finalize.
      if (cat.status === "upcoming") continue;
      if (cat.status === "running") {
        await updateCategory({ ...cat, status: "finished" as const, finishedAt: now.getTime() });
      }
      const catRiders = riders.filter(
        (r) => riderInCategory(r, cat) && r.raceUuid === raceUuid && r.status !== "DNS"
      );
      const updatedRiders = catRiders.map((r) => {
        const isOut = r.status === "DNF" || r.status === "DSQ" || r.status === "DNS";
        return {
          ...r,
          // Ending the race finalizes EVERY rider — including those still on the
          // track — so Live is clean and the next wave starts from a blank slate.
          raceStatus: "finished" as const,
          status: isOut ? r.status : ("finished" as const),
          elapsedTimeFromStart:
            r.elapsedTimeFromStart ?? formatElapsed(now, r.timeStartRace),
        };
      });
      if (updatedRiders.length > 0) await updateAllRiders(updatedRiders);
    }

  };

  // Finish the ENTIRE wave: every category is closed, every started rider is
  // finalized in the DB, and never-started categories are marked finished so
  // the wave signs off as done (no new start groups can be added afterwards).
  const finishWave = async () => {
    const now = new Date();
    setCountdown(null);

    for (const cat of categories) {
      if (cat.status === "finished") continue;
      const wasStarted = cat.status === "running";
      await updateCategory({ ...cat, status: "finished" as const, finishedAt: now.getTime() });
      // Categories that never started have no riders on the road to finalize.
      if (!wasStarted) continue;

      const catRiders = riders.filter(
        (r) => riderInCategory(r, cat) && r.raceUuid === raceUuid && r.status !== "DNS"
      );
      const updatedRiders = catRiders.map((r) => {
        const isOut = r.status === "DNF" || r.status === "DSQ" || r.status === "DNS";
        return {
          ...r,
          raceStatus: "finished" as const,
          status: isOut ? r.status : ("finished" as const),
          elapsedTimeFromStart:
            r.elapsedTimeFromStart ?? formatElapsed(now, r.timeStartRace),
        };
      });
      if (updatedRiders.length > 0) await updateAllRiders(updatedRiders);
    }
  };

  const adjustTime = (groupId: string, seconds: number) => {
    setStartGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;

        // Parse current time or use current time if empty
        let timeDate: Date;
        if (g.time) {
          const [hours, minutes, secs = 0] = g.time.split(":").map(Number);
          timeDate = new Date();
          timeDate.setHours(hours, minutes, secs, 0);
        } else {
          timeDate = new Date();
        }

        // Add/subtract seconds
        timeDate.setSeconds(timeDate.getSeconds() + seconds);

        // Format back to HH:MM:SS
        const newTime = timeDate.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        });

        return { ...g, time: newTime };
      })
    );
  };

  const setTimeToNow = (groupId: string) => {
    const now = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    setStartGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, time: now } : g))
    );
  };

  const saveStartGroupCategories = async (
    groupId: string,
    categoryIds: number[]
  ) => {
    // Update categories with the new start time
    const group = startGroups.find((g) => g.id === groupId);
    if (!group) return;

    for (const catId of categoryIds) {
      const cat = categories.find((c) => c.id === catId);
      if (cat) {
        await updateCategory({
          ...cat,
          startTime: group.time || null
        });
      }
    }

    // Update local state
    setStartGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, categoryIds } : g))
    );
  };

  const addNewStart = () => {
    const newStart: StartGroup = {
      id: `start-${Date.now()}`,
      time: "",
      categoryIds: []
    };
    setStartGroups([...startGroups, newStart]);
  };

  const deleteStart = async (groupId: string) => {
    const group = startGroups.find((g) => g.id === groupId);
    if (!group) return;

    // Clear start times for categories in this group
    for (const catId of group.categoryIds) {
      const cat = categories.find((c) => c.id === catId);
      if (cat) {
        await updateCategory({ ...cat, startTime: null });
      }
    }

    setStartGroups(startGroups.filter((g) => g.id !== groupId));
  };

  // Get all assigned category IDs (excluding the one being edited)
  const getAssignedCategoryIds = (excludeGroupId?: string) => {
    const assigned = new Set<number>();
    startGroups.forEach((g) => {
      if (g.id !== excludeGroupId) {
        g.categoryIds.forEach((id) => assigned.add(id));
      }
    });
    return assigned;
  };

  const toggleExpandFinished = (groupId: string) => {
    setExpandedFinished((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  if (!categories.length) {
    return <div className={styles.empty}>No categories in this wave.</div>;
  }

  return (
    <div className={styles.container}>
      {startError && (
        <div className={styles.modalOverlay} onClick={() => setStartError(null)}>
          <div className={styles.errorModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.errorModalHeader}>
              <span>Cannot Start Race</span>
              <button className={styles.errorClose} onClick={() => setStartError(null)}>✕</button>
            </div>
            <div className={styles.errorList}>
              {startError.map((msg, i) => (
                <div key={i} className={styles.errorItem}>
                  <span className={styles.errorIcon}>⚠</span>
                  {msg}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {countdown && (
        <Countdown
          seconds={countdown.seconds}
          groupLabel={`Start ${startGroups.findIndex((g) => g.id === countdown.groupId) + 1}`}
          onDone={() => {
            const group = startGroups.find((g) => g.id === countdown.groupId);
            if (group) startGroup(group);
            setCountdown(null);
          }}
          onStart={() => {
            const group = startGroups.find((g) => g.id === countdown.groupId);
            if (group) startGroup(group);
          }}
          onCancel={() => setCountdown(null)}
        />
      )}

      {editingStartId && (
        <ManageCategoriesModal
          startGroup={startGroups.find((g) => g.id === editingStartId)!}
          allCategories={categories}
          assignedCategoryIds={getAssignedCategoryIds(editingStartId)}
          onClose={() => setEditingStartId(null)}
          onSave={(categoryIds) =>
            saveStartGroupCategories(editingStartId, categoryIds)
          }
        />
      )}

      <div className={styles.header}>
        <div className={styles.currentTime}>
          <span className={styles.timeLabel}>Current Time:</span>
          <span className={styles.timeValue}>
            {currentTime.toLocaleTimeString("en-GB")}
          </span>
        </div>
        <div className={styles.headerActions}>
          {waveFinished ? (
            <span className={styles.waveFinishedBadge}>
              <Flag size={13} /> Wave {waveNum} finished
            </span>
          ) : (
            <>
              {waveHasStarted &&
                (confirmFinishWave ? (
                  <div className={styles.confirmInline}>
                    <span className={styles.confirmText}>Finish whole wave?</span>
                    <button
                      className={styles.confirmYes}
                      onClick={() => { finishWave(); setConfirmFinishWave(false); }}
                    >
                      Yes <Flag size={13} />
                    </button>
                    <button
                      className={styles.confirmNo}
                      onClick={() => setConfirmFinishWave(false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className={styles.finishWaveBtn}
                    onClick={() => setConfirmFinishWave(true)}
                    title="Finish all starts in this wave and close it"
                  >
                    <Flag size={13} /> Finish Wave
                  </button>
                ))}
              <Button
                variant="primary"
                size="sm"
                startIcon={<Plus size={14} />}
                onClick={addNewStart}
              >
                Add Start Group
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Wave Time Control */}
      <div className={styles.waveTimeControl}>
        <div className={styles.waveTimeHeader}>
          <span className={styles.waveLabel}>Wave {waveNum} Start Time</span>
          <span className={styles.waveTimeHelp}>
            {waveHasStarted
              ? "🔒 Locked — wave already started"
              : "(Adjusting wave time shifts all starts)"}
          </span>
        </div>
        <div className={styles.waveTimeAdjust}>
          <button
            className={styles.waveTimeBtn}
            onClick={() => adjustWaveTime(-30)}
            disabled={waveHasStarted}
            title={waveHasStarted ? "Time locked — wave already started" : "Shift all starts -30 seconds"}
          >
            − 30s
          </button>
          <span
            className={styles.waveTimeDisplay}
            onClick={waveHasStarted ? undefined : setWaveTimeToNow}
            style={waveHasStarted ? { cursor: "default" } : undefined}
            title={waveHasStarted ? "Time locked — wave already started" : "Click to set wave time to now"}
          >
            {waveBaseTime || "Not Set"}
          </span>
          <button
            className={styles.waveTimeBtn}
            onClick={() => adjustWaveTime(30)}
            disabled={waveHasStarted}
            title={waveHasStarted ? "Time locked — wave already started" : "Shift all starts +30 seconds"}
          >
            + 30s
          </button>
        </div>
      </div>

      {otherWaveRunning && (
        <div className={styles.otherWaveBanner}>
          ⚠ Another wave is still running — finish it before starting this wave.
        </div>
      )}

      {startGroups.map((group, si) => {
        const cats = group.categoryIds
          .map((id) => categories.find((c) => c.id === id))
          .filter(Boolean) as CategoryProps[];
        const hasCategories = cats.length > 0;
        // Derive finished from persisted category status — not local state that resets on navigation
        const isFinished = cats.length > 0 && cats.every((c) => c.status === "finished");
        const allStarted = cats.length > 0 && cats.every((c) => c.status !== "upcoming");
        const isRunning = allStarted && !isFinished;
        const firstStartTime = cats.find((c) => c.startTime)?.startTime;
        const catIssuesMap = Object.fromEntries(cats.map((c) => [c.id, getCatIssues(c)]));
        const totalIssues = Object.values(catIssuesMap).reduce((s, arr) => s + arr.length, 0);
        const groupBlockReasons = totalIssues > 0 ? validateGroup(group) : [];

        /* ── FINISHED ── */
        if (isFinished) {
          return (
            <div key={group.id} className={styles.startBlockFinished}>
              <div className={styles.startHeader}>
                <div className={styles.startInfo}>
                  <span className={styles.finishedFlag}><Flag size={16} /></span>
                  <span className={styles.startLabel}>Start {si + 1}</span>
                  <span className={styles.startTimeReadOnly}>{group.time || "--:--"}</span>
                  <span className={styles.finishedBadge}>FINISHED</span>
                </div>
                <button
                  className={styles.expandBtn}
                  onClick={() => toggleExpandFinished(group.id)}
                  title={expandedFinished.has(group.id) ? "Collapse" : "Expand"}
                >
                  {expandedFinished.has(group.id) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>
              {expandedFinished.has(group.id) && (
                <div className={styles.catList}>
                  {cats.map((cat) => (
                    <div key={cat.id} className={styles.catRow}>
                      <div className={styles.colorDot} style={{ background: cat.color ?? "#ccc" }} />
                      <span className={styles.catName}>
                        {cat.name}
                        {cat.subCategory && <span className={styles.subCategory}> · {cat.subCategory}</span>}
                      </span>
                      <span className={`${styles.statusTag} ${styles.finished}`}>finished</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }

        /* ── RUNNING ── */
        if (isRunning) {
          // Use rider timeStartRace for actual elapsed (cat.startTime is the scheduled time)
          const runningRider = riders.find(
            (r) => r.raceUuid === raceUuid && cats.some((c) => riderInCategory(r, c)) && r.raceStatus === "running" && r.timeStartRace
          );
          const actualStart = runningRider?.timeStartRace ?? group.time;

          return (
            <div key={group.id} className={`${styles.startBlock} ${styles.startBlockRunning}`}>
              <div className={`${styles.startHeader} ${styles.startHeaderRunning}`}>
                <div className={styles.startInfo}>
                  <span className={styles.startLabel}>Start {si + 1}</span>
                  <span className={styles.startTimeReadOnly}>{group.time || "--:--"}</span>
                  <span className={styles.runningBadge}>● RUNNING</span>
                </div>
              </div>

              <div className={styles.catList}>
                {cats.map((cat) => {
                  const catRider = riders.find(
                    (r) => r.raceUuid === raceUuid && riderInCategory(r, cat) && r.raceStatus === "running" && r.timeStartRace
                  );
                  return (
                    <div key={cat.id} className={styles.catRow}>
                      <div className={styles.colorDot} style={{ background: cat.color ?? "#ccc" }} />
                      <span className={styles.catName}>
                        {cat.name}
                        {cat.subCategory && <span className={styles.subCategory}> · {cat.subCategory}</span>}
                      </span>
                      <span className={`${styles.statusTag} ${styles.running}`}>running</span>
                      {catRider?.timeStartRace && (
                        <span className={styles.catElapsed}>
                          {formatElapsed(currentTime, catRider.timeStartRace)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className={styles.actions}>
                <div className={styles.runningBar}>
                  <span className={styles.startedLabel}>
                    Started {actualStart?.substring(0, 5) ?? "--:--"}
                  </span>
                  <span className={styles.elapsedDisplay}>
                    {formatElapsed(currentTime, actualStart)}
                  </span>
                </div>
                {confirmFinishId === group.id ? (
                  <div className={styles.confirmInline}>
                    <span className={styles.confirmText}>End race?</span>
                    <button
                      className={styles.confirmYes}
                      onClick={() => { endRace(group); setConfirmFinishId(null); }}
                    >
                      Yes <Flag size={14} />
                    </button>
                    <button
                      className={styles.confirmNo}
                      onClick={() => setConfirmFinishId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className={styles.endRaceBtn}
                    onClick={() => setConfirmFinishId(group.id)}
                    title="Finish race"
                  >
                    <Flag size={15} /> Finish
                  </button>
                )}
              </div>
            </div>
          );
        }

        /* ── UPCOMING ── */
        return (
          <div key={group.id} className={styles.startBlock}>
            <div className={styles.startHeader}>
              <div className={styles.startInfo}>
                <span className={styles.startLabel}>Start {si + 1}</span>
                {totalIssues > 0 && (
                  <span className={styles.groupWarnBadge} title={`${totalIssues} issue${totalIssues > 1 ? "s" : ""} — not ready to start`}>
                    <AlertTriangle size={13} />
                    {totalIssues}
                  </span>
                )}
                <div className={styles.timeControls}>
                  <button
                    className={styles.timeBtn}
                    onClick={() => adjustTime(group.id, -30)}
                    title="Decrease 30 seconds"
                  >
                    −
                  </button>
                  <span
                    className={styles.startTime}
                    onClick={() => setTimeToNow(group.id)}
                    title="Click to set to current time"
                  >
                    {group.time || "Not Set"}
                  </span>
                  <button
                    className={styles.timeBtn}
                    onClick={() => adjustTime(group.id, 30)}
                    title="Increase 30 seconds"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className={styles.startActions}>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  onClick={() => setEditingStartId(group.id)}
                  title="Manage categories"
                >
                  <Edit2 size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  onClick={() => deleteStart(group.id)}
                  title="Delete start"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>

            {hasCategories ? (
              <>
                <div className={styles.catList}>
                  {cats.map((cat) => {
                    const catRiders = riders.filter((r) => r.raceUuid === raceUuid && riderInCategory(r, cat));
                    const total = catRiders.length;
                    const accounted = catRiders.filter((r) => r.checked || ["DNS", "DNF", "DSQ"].includes(r.status)).length;
                    const allIn = total > 0 && accounted >= total;
                    const issues = catIssuesMap[cat.id] ?? [];
                    return (
                      <div key={cat.id} className={`${styles.catRow} ${issues.length > 0 ? styles.catRowWarn : ""}`}>
                        <div className={styles.colorDot} style={{ background: cat.color ?? "#ccc" }} />
                        <span className={styles.catName}>
                          {cat.name}
                          {cat.subCategory && (
                            <span className={styles.subCategory}> · {cat.subCategory}</span>
                          )}
                        </span>
                        {total > 0 && (
                          <span className={allIn ? styles.checkCountOk : styles.checkCountPending} title="Checked in">
                            🚴 {accounted}/{total}
                          </span>
                        )}
                        <span className={`${styles.statusTag}`}>{cat.status ?? "upcoming"}</span>
                        {issues.length > 0 && (
                          <span className={styles.catWarnIcon} title={issues.join(" · ")}>
                            <AlertTriangle size={13} />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {totalIssues > 0 && (
                  <div className={styles.blockedPanel}>
                    <div className={styles.blockedTitle}>
                      <AlertTriangle size={14} />
                      <span>Not ready to start</span>
                    </div>
                    {groupBlockReasons.map((msg, i) => (
                      <div key={i} className={styles.blockedReason} dir="auto">
                        {msg}
                      </div>
                    ))}
                    <div className={styles.blockedHint}>
                      Set laps in Categories and check riders in at Check-In to enable start.
                    </div>
                  </div>
                )}

                <div className={styles.actions}>
                  {[30, 60, 120].map((sec) => (
                    <button
                      key={sec}
                      className={`${styles.countdownBtn} ${totalIssues > 0 ? styles.btnBlocked : ""}`}
                      disabled={otherWaveRunning}
                      aria-disabled={totalIssues > 0}
                      title={otherWaveRunning ? "Another wave is still running" : totalIssues > 0 ? "Resolve check-in / laps issues first" : undefined}
                      onClick={() => {
                        if (otherWaveRunning) { setStartError(["Another wave is still running — finish it before starting this wave."]); return; }
                        const errors = validateGroup(group);
                        if (errors.length > 0) { setStartError(errors); return; }
                        setCountdown({ groupId: group.id, seconds: sec });
                      }}
                    >
                      ⏱ {sec === 30 ? "30s" : sec === 60 ? "1 Min" : "2 Min"}
                    </button>
                  ))}
                  <button
                    className={`${styles.startBtn} ${totalIssues > 0 ? styles.btnBlocked : ""}`}
                    disabled={otherWaveRunning}
                    aria-disabled={totalIssues > 0}
                    title={otherWaveRunning ? "Another wave is still running" : totalIssues > 0 ? "Resolve check-in / laps issues first" : undefined}
                    onClick={() => startGroup(group)}
                  >
                    <img src={Icons.buttonStart} alt="" width={14} height={14} />
                    Start All
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.emptyStart}>
                <p>No categories assigned to this start</p>
                <Button variant="secondary" size="sm" onClick={() => setEditingStartId(group.id)}>
                  Add Categories
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default StartManager;
