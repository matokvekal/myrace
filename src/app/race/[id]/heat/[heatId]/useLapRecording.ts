import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { RiderProps } from "@/types/types";
import { formatTime, parseClockTime } from "@/utils/timeUtils";
import calculatePositions from "@/utils/calculatePosition";
import { recordRaceEvent } from "@/services/cloud/raceEvents";
import { canForRace } from "@/services/cloud/permissions";

/**
 * The lap-recording core of the live heat screen (BUGS.md #29).
 *
 * Extracted verbatim from `heat/[heatId]/page.tsx` — same rules, same order of
 * operations, same side effects. This is deliberately ONLY lap recording and
 * lap rollback; filtering, voice, modals and the clear-board flow stay in the
 * component. Nothing about the UI or public behaviour changes.
 */

/** A rider can't record two laps inside a minute. */
export const MIN_LAP_MS = 60 * 1000;

/**
 * Persisted-log key prefix (BUGS.md #2). The action log is the complete,
 * chronological record of every arrival in a wave — the thing that settles a
 * disputed placing. It used to live only in React state, so a reload mid-wave
 * wiped it. We now mirror it to localStorage per wave.
 */
const LOG_STORAGE_PREFIX = "commissaire.actionLog.";

function loadPersistedActions(key: string | null): RiderAction[] {
  if (!key || typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOG_STORAGE_PREFIX + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RiderAction[]) : [];
  } catch {
    return [];
  }
}

export interface RiderAction {
  id: string;
  rider: RiderProps;
  /** Exact pre-tap snapshot, so an undo restores byte-for-byte (BUGS.md #10). */
  prevRider?: RiderProps;
  prevOrderIndex?: number;
  timestamp: number;
  source: "click" | "voice";
  categoryColor: string;
  statusChange?: "DNF" | "DSQ" | "DNS";
}

interface Params {
  raceUuid: string;
  /**
   * Stable key that identifies THIS wave's log (e.g. `${raceUuid}:heat:${heatId}`).
   * The action log is persisted under it so a mid-wave reload restores every
   * arrival. `null` disables persistence (kept in-memory only).
   */
  persistKey: string | null;
  riders: RiderProps[];
  updateRider: (rider: RiderProps) => void;
  updateAllRiders: (riders: RiderProps[]) => void;
  /** Km per lap, when the race defines a circuit length. */
  circuitKm: number | null;
  /** True when the rider's category has already been flagged off. */
  isOnTrackAfterEnd: (rider: RiderProps) => boolean;
  getCatColor: (rider: RiderProps) => string;
  displayOrder: number[];
  setDisplayOrder: React.Dispatch<React.SetStateAction<number[]>>;
  onLapRecorded?: (rider: RiderProps, catColor: string, source: "click" | "voice") => void;
}

export function useLapRecording({
  raceUuid,
  persistKey,
  riders,
  updateRider,
  updateAllRiders,
  circuitKm,
  isOnTrackAfterEnd,
  getCatColor,
  displayOrder,
  setDisplayOrder,
  onLapRecorded,
}: Params) {
  // Hydrate synchronously from storage so the log is complete on first paint
  // after a reload (BUGS.md #2) instead of flashing empty then filling in.
  const [riderActions, setRiderActions] = useState<RiderAction[]>(() =>
    loadPersistedActions(persistKey)
  );
  const [flashingRiderId, setFlashingRiderId] = useState<number | null>(null);

  // Re-hydrate when the wave changes, and persist every edit back to storage.
  // `pendingHydrationRef` holds the array we just loaded so the save effect can
  // tell a hydration-triggered state change from a real user edit — without it,
  // the transitional render (persistKey changed, state not yet applied) would
  // write the OLD wave's log under the NEW wave's key.
  const persistKeyRef = useRef<string | null>(persistKey);
  const pendingHydrationRef = useRef<RiderAction[] | null>(null);

  useEffect(() => {
    persistKeyRef.current = persistKey;
    const loaded = loadPersistedActions(persistKey);
    pendingHydrationRef.current = loaded;
    setRiderActions(loaded);
  }, [persistKey]);

  useEffect(() => {
    // Skip the write caused by hydration itself; only persist real changes.
    if (pendingHydrationRef.current === riderActions) {
      pendingHydrationRef.current = null;
      return;
    }
    if (pendingHydrationRef.current !== null) return; // hydration in flight
    const key = persistKeyRef.current;
    if (!key || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(LOG_STORAGE_PREFIX + key, JSON.stringify(riderActions));
    } catch {
      /* quota / serialization — the log is a convenience, never block scoring. */
    }
  }, [riderActions]);

  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Pending "drop to end of queue" timers, so an undo inside 1s can cancel it. */
  const reorderTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const lastActionRef = useRef<{ riderId: number; timestamp: number } | null>(null);

  const recordLap = (rider: RiderProps, source: "click" | "voice" = "click"): void => {
    if ((rider.totalLaps > 0 && rider.lapsCounter >= rider.totalLaps) || rider.raceStatus === "finished") return;

    if (!canForRace(raceUuid, "MARK_LAP")) {
      toast.warn("No permission to mark laps");
      return;
    }

    const clickTime = new Date();

    // Debounce rapid duplicate taps / voice detections for the same rider.
    if (lastActionRef.current && lastActionRef.current.riderId === rider.id) {
      if (clickTime.getTime() - lastActionRef.current.timestamp < 500) return;
    }

    if (rider.timeArrive) {
      const msSinceLast = clickTime.getTime() - new Date(rider.timeArrive).getTime();
      if (msSinceLast < MIN_LAP_MS) {
        const remaining = Math.ceil((MIN_LAP_MS - msSinceLast) / 1000);
        toast.info(`Wait ${remaining}s before next lap`);
        return;
      }
    }

    const lapsCounter = (rider.lapsCounter || 0) + 1;
    const raceStart = parseClockTime(rider.timeStartRace) ?? clickTime;
    const lastLapStart = rider.timeArrive ? new Date(rider.timeArrive) : raceStart;
    const lapMs = clickTime.getTime() - lastLapStart.getTime();
    const lapTime = formatTime(lapMs / 1000);
    // A rider whose category race already ended finishes on their next crossing,
    // regardless of remaining laps — the flag is out, this lap is their last.
    const isFinished =
      (rider.totalLaps > 0 && lapsCounter >= rider.totalLaps) || isOnTrackAfterEnd(rider);
    const speed_kph = circuitKm
      ? Math.round((circuitKm / (lapMs / 3600000)) * 10) / 10
      : undefined;

    const intermediateRider: RiderProps = {
      ...rider,
      lapsCounter,
      elapsedLastLap: lapTime,
      elapsedTimeFromStart: formatTime((clickTime.getTime() - raceStart.getTime()) / 1000),
      timeArrive: clickTime.toISOString(),
      raceStatus: isFinished ? "finished" : "running",
    };

    const allWithUpdated = riders.map((r) => (r.id === intermediateRider.id ? intermediateRider : r));
    const sorted = calculatePositions(allWithUpdated);
    const positionAtLap = sorted.find((r) => r.id === rider.id)?.position_category ?? rider.position_category;

    const updatedRider: RiderProps = {
      ...intermediateRider,
      position_category: positionAtLap,
      lapsDetails: [
        ...(rider.lapsDetails ?? []),
        { lap: lapsCounter, startTime: lastLapStart, endTime: clickTime, lapTime, position: positionAtLap, speed_kph },
      ],
    };

    const finalSorted = sorted.map((r) => (r.id === updatedRider.id ? updatedRider : r));
    lastActionRef.current = { riderId: rider.id, timestamp: clickTime.getTime() };
    updateRider(updatedRider);
    updateAllRiders(finalSorted);

    void recordRaceEvent({
      raceUuid,
      riderId: rider.id,
      bibNumber: rider.bibNumber,
      eventType: "LAP_MARKED",
      lapNumber: lapsCounter,
      payload: {
        riderLocalId: rider.id,
        riderPatch: {
          lapsCounter: updatedRider.lapsCounter,
          lapsDetails: updatedRider.lapsDetails,
          elapsedLastLap: updatedRider.elapsedLastLap,
          elapsedTimeFromStart: updatedRider.elapsedTimeFromStart,
          timeArrive: updatedRider.timeArrive,
          raceStatus: updatedRider.raceStatus,
          position_category: updatedRider.position_category,
        },
      },
    });

    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashingRiderId(rider.id);
    flashTimerRef.current = setTimeout(() => setFlashingRiderId(null), 1200);

    // After the flash, drop this rider to the literal end of the queue (or off it
    // entirely if they just finished) — "tap it, it goes last" always means last.
    const pendingReorder = reorderTimersRef.current.get(rider.id);
    if (pendingReorder) clearTimeout(pendingReorder);
    reorderTimersRef.current.set(
      rider.id,
      setTimeout(() => {
        reorderTimersRef.current.delete(rider.id);
        setDisplayOrder((prev) => {
          const rest = prev.filter((id) => id !== rider.id);
          return isFinished ? rest : [...rest, rider.id];
        });
      }, 1000)
    );

    const catColor = getCatColor(rider);
    const actionTimestamp = Date.now();
    onLapRecorded?.(rider, catColor, source);

    // `rider` here is still the pre-tap snapshot — keep it for an exact undo.
    const prevOrderIndex = displayOrder.indexOf(rider.id);
    setRiderActions((prev) => [
      {
        id: `${rider.id}-${lapsCounter}-${actionTimestamp}`,
        rider: updatedRider,
        prevRider: rider,
        prevOrderIndex: prevOrderIndex === -1 ? undefined : prevOrderIndex,
        timestamp: actionTimestamp,
        source,
        categoryColor: catColor,
      },
      ...prev,
    ]);
  };

  /** Put a rider back exactly where they were before their last recorded lap. */
  const restoreFromSnapshot = (rider: RiderProps, snapshot: RiderAction | undefined): void => {
    const newDetails = (rider.lapsDetails ?? []).slice(0, -1);
    const prevArrive = newDetails.length > 0
      ? new Date(newDetails[newDetails.length - 1].endTime).toISOString()
      : null;
    const revertedRider: RiderProps = snapshot?.prevRider
      ? { ...snapshot.prevRider }
      : {
          ...rider,
          lapsCounter: rider.lapsCounter - 1,
          lapsDetails: newDetails,
          timeArrive: prevArrive,
          raceStatus: "running",
          elapsedLastLap: newDetails.length > 0 ? newDetails[newDetails.length - 1].lapTime : null,
        };
    updateRider(revertedRider);

    // Stop any pending drop-to-end, and put them back where they were.
    const pendingReorder = reorderTimersRef.current.get(rider.id);
    if (pendingReorder) {
      clearTimeout(pendingReorder);
      reorderTimersRef.current.delete(rider.id);
    }
    if (snapshot?.prevOrderIndex !== undefined) {
      const at = snapshot.prevOrderIndex;
      setDisplayOrder((prev) => {
        const rest = prev.filter((id) => id !== rider.id);
        const idx = Math.min(at, rest.length);
        return [...rest.slice(0, idx), rider.id, ...rest.slice(idx)];
      });
    }
    if (snapshot) setRiderActions((prev) => prev.filter((a) => a.id !== snapshot.id));

    void recordRaceEvent({
      raceUuid,
      riderId: rider.id,
      bibNumber: rider.bibNumber,
      eventType: "UNDO",
      lapNumber: rider.lapsCounter,
      payload: {
        riderLocalId: rider.id,
        riderPatch: {
          lapsCounter: revertedRider.lapsCounter,
          lapsDetails: revertedRider.lapsDetails,
          timeArrive: revertedRider.timeArrive,
          raceStatus: revertedRider.raceStatus,
          elapsedLastLap: revertedRider.elapsedLastLap,
        },
      },
    });
  };

  /** Undo a rider's most recent lap (from the rider modal). */
  const revertLap = (rider: RiderProps): boolean => {
    if (rider.lapsCounter <= 0) return false;
    if (!canForRace(raceUuid, "UNDO_EVENT")) {
      toast.warn("No permission to undo laps");
      return false;
    }
    // Prefer the exact pre-tap snapshot over rebuilding from lapsDetails, which
    // silently drops elapsedTimeFromStart and position_category (BUGS.md #10).
    const snapshot = riderActions.find(
      (a) => a.prevRider && a.prevRider.id === rider.id && a.rider.lapsCounter === rider.lapsCounter
    );
    restoreFromSnapshot(rider, snapshot);
    return true;
  };

  /** Undo a specific entry in the action log. */
  const cancelAction = (actionId: string): RiderProps | null => {
    const action = riderActions.find((a) => a.id === actionId);
    if (!action) return null;

    const riderIdStr = actionId.split("-")[0];
    const rider = riders.find((r) => r.id === Number(riderIdStr));
    if (!rider || rider.lapsCounter <= 0) return null;

    const pendingReorder = reorderTimersRef.current.get(rider.id);
    if (pendingReorder) {
      clearTimeout(pendingReorder);
      reorderTimersRef.current.delete(rider.id);
    }

    if (action.prevRider) {
      updateRider({ ...action.prevRider });
    } else {
      const newDetails = (rider.lapsDetails ?? []).slice(0, -1);
      const prevArrive = newDetails.length > 0
        ? new Date(newDetails[newDetails.length - 1].endTime).toISOString()
        : null;
      updateRider({
        ...rider,
        lapsCounter: rider.lapsCounter - 1,
        lapsDetails: newDetails,
        timeArrive: prevArrive,
        raceStatus: "running",
        elapsedLastLap: newDetails.length > 0 ? newDetails[newDetails.length - 1].lapTime : null,
      });
    }

    if (action.prevOrderIndex !== undefined) {
      setDisplayOrder((prev) => {
        const rest = prev.filter((id) => id !== rider.id);
        const at = Math.min(action.prevOrderIndex as number, rest.length);
        return [...rest.slice(0, at), rider.id, ...rest.slice(at)];
      });
    }

    setRiderActions((prev) => prev.filter((a) => a.id !== actionId));
    return rider;
  };

  /** Log a DNF/DSQ/DNS so it shows in the action log alongside laps. */
  const logStatusChange = (rider: RiderProps, status: "DNF" | "DSQ" | "DNS"): void => {
    setRiderActions((prev) => [
      {
        id: `${rider.id}-status-${status}-${Date.now()}`,
        rider,
        timestamp: Date.now(),
        source: "click",
        categoryColor: getCatColor(rider),
        statusChange: status,
      },
      ...prev,
    ]);
  };

  /**
   * Clear pending timers — call from the component's unmount effect.
   *
   * MUST be a stable reference: the page wires it as
   * `useEffect(() => clearTimers, [clearTimers])`. If its identity changed each
   * render, that effect's cleanup would fire on EVERY render and kill the
   * pending "drop to end" timer before its 1s elapsed — so tapped cards never
   * moved to the end (live regression). It only touches refs, so `[]` is safe.
   */
  const clearTimers = useCallback((): void => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    reorderTimersRef.current.forEach((t) => clearTimeout(t));
    reorderTimersRef.current.clear();
  }, []);

  return {
    riderActions,
    setRiderActions,
    flashingRiderId,
    recordLap,
    revertLap,
    cancelAction,
    logStatusChange,
    clearTimers,
  };
}
