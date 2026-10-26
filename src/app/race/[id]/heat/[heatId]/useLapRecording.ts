import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { RiderProps } from "@/types/types";
import { formatTime, parseClockTime } from "@/utils/timeUtils";
import calculatePositions from "@/utils/calculatePosition";
import { recordRaceEvent } from "@/services/cloud/raceEvents";
import { canForRace } from "@/services/cloud/permissions";
import { logAnalyticsEvent } from "@/services/analytics/analyticsClient";
import useRaceStore from "@/stores/racesStore";
import { AuditLogService } from "@/services/auditLog/auditLogService";
import { maxBoardHoldMs, normalizeBoardHoldMs } from "@/stores/boardHoldStore";

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

/** Manual-finish entries that were undone and can still be redone (per wave). */
const REDO_STORAGE_PREFIX = "commissaire.finishRedo.";

function loadPersistedRedo(key: string | null): RiderAction[] {
  if (!key || typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(REDO_STORAGE_PREFIX + key) ?? "[]");
    return Array.isArray(parsed) ? (parsed as RiderAction[]) : [];
  } catch {
    return [];
  }
}

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
  statusChange?: "DNF" | "DSQ" | "DNS" | "FINISH";
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
  /**
   * Board hold: ms of no taps before every tapped card drops to the end of the
   * queue, all at once. See `stores/boardHoldStore.ts` for why this is a
   * board-wide trailing debounce and not a per-card delay.
   */
  boardHoldMs: number;
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
  boardHoldMs,
  onLapRecorded,
}: Params) {
  const holdMs = normalizeBoardHoldMs(boardHoldMs);
  const race = useRaceStore((s) => s.races.find((r) => r.uuid === raceUuid));
  // Hydrate synchronously from storage so the log is complete on first paint
  // after a reload (BUGS.md #2) instead of flashing empty then filling in.
  const [riderActions, setRiderActions] = useState<RiderAction[]>(() =>
    loadPersistedActions(persistKey)
  );
  const [flashingRiderId, setFlashingRiderId] = useState<number | null>(null);
  // Undone manual finishes, newest first. Kept (and persisted) so Redo restores the
  // ORIGINAL finish stamp from the action history instead of re-finishing "now".
  const [undoneFinishes, setUndoneFinishesState] = useState<RiderAction[]>(() => loadPersistedRedo(persistKey));
  const redoKeyRef = useRef<string | null>(persistKey);
  const setUndoneFinishes = (next: RiderAction[]) => {
    setUndoneFinishesState(next);
    const key = redoKeyRef.current;
    if (!key || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(REDO_STORAGE_PREFIX + key, JSON.stringify(next));
    } catch {
      /* convenience only */
    }
  };
  useEffect(() => {
    redoKeyRef.current = persistKey;
    setUndoneFinishesState(loadPersistedRedo(persistKey));
  }, [persistKey]);

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
  const lastActionRef = useRef<{ riderId: number; timestamp: number } | null>(null);

  // ── Board hold ────────────────────────────────────────────────────────────
  // Riders that have been tapped but whose cards are still sitting where they
  // were. Insertion-ordered (Map) so the flush drops them to the bottom in the
  // order they were actually tapped. Value = "this tap finished them", which
  // means removed from the queue instead of appended.
  const pendingMoveRef = useRef<Map<number, boolean>>(new Map());
  /** Same ids, mirrored into state so the cards can render as "already tapped". */
  const [pendingMoveIds, setPendingMoveIds] = useState<number[]>([]);
  /** Restarted by every tap — the actual debounce. */
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Started once with the FIRST pending card and never restarted (safety valve). */
  const maxHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopHoldTimers = (): void => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (maxHoldTimerRef.current) clearTimeout(maxHoldTimerRef.current);
    holdTimerRef.current = null;
    maxHoldTimerRef.current = null;
  };

  /** Move every pending card to the end of the queue in one go. */
  const flushPendingMoves = (): void => {
    stopHoldTimers();
    const entries = [...pendingMoveRef.current.entries()];
    if (entries.length === 0) return;
    pendingMoveRef.current.clear();
    setPendingMoveIds([]);
    setDisplayOrder((prev) => {
      const moving = new Set(entries.map(([id]) => id));
      const rest = prev.filter((id) => !moving.has(id));
      const tail = entries.filter(([, finished]) => !finished).map(([id]) => id);
      return [...rest, ...tail];
    });
  };

  /** Hold this rider's card in place and (re)start the board-wide countdown. */
  const holdPendingMove = (riderId: number, finished: boolean): void => {
    const pending = pendingMoveRef.current;
    const isFirst = pending.size === 0;
    pending.set(riderId, finished);
    setPendingMoveIds([...pending.keys()]);

    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(flushPendingMoves, holdMs);

    if (isFirst) {
      if (maxHoldTimerRef.current) clearTimeout(maxHoldTimerRef.current);
      maxHoldTimerRef.current = setTimeout(flushPendingMoves, maxBoardHoldMs(holdMs));
    }
  };

  /** Undo path: this tap is being taken back, so it must not move anything. */
  const dropPendingMove = (riderId: number): void => {
    const pending = pendingMoveRef.current;
    if (!pending.delete(riderId)) return;
    setPendingMoveIds([...pending.keys()]);
    if (pending.size === 0) stopHoldTimers();
  };

  /** Wave change: drop the previous wave's pending moves without applying them. */
  useEffect(() => {
    stopHoldTimers();
    pendingMoveRef.current.clear();
    setPendingMoveIds([]);
  }, [persistKey]);

  /**
   * @param atTime Backdate the lap to an earlier moment — used when resolving a
   * Joker (an instant time+arrival stamp taken before the rider was identified)
   * so the recorded lap reflects when it actually happened, not when it was
   * resolved. Omit for a normal tap, which stamps "now" exactly as before.
   */
  const recordLap = (rider: RiderProps, source: "click" | "voice" = "click", atTime?: Date): void => {
    if ((rider.totalLaps > 0 && rider.lapsCounter >= rider.totalLaps) || rider.raceStatus === "finished") return;

    if (!canForRace(raceUuid, "MARK_LAP")) {
      toast.warn("No permission to mark laps");
      return;
    }

    const clickTime = atTime ?? new Date();
    const now = Date.now();

    // Debounce rapid duplicate taps / voice detections for the same rider.
    // Keyed off real wall-clock `now`, not `clickTime` — a backdated Joker
    // resolution would otherwise produce a negative (always-truthy) diff here
    // and get silently swallowed.
    if (lastActionRef.current && lastActionRef.current.riderId === rider.id) {
      if (now - lastActionRef.current.timestamp < 500) return;
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
    lastActionRef.current = { riderId: rider.id, timestamp: now };
    updateRider(updatedRider);
    updateAllRiders(finalSorted);
    logAnalyticsEvent("lap_recorded", { source, race_uuid: raceUuid });
    if (race) {
      AuditLogService.log({
        race,
        action: "RECORD_LAP",
        screen: "Heat",
        entityType: "rider",
        entityId: rider.bibNumber,
        details: { lap: lapsCounter, lapTime, source, finished: isFinished },
      });
    }

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

    // This rider still goes to the literal end of the queue (or off it entirely
    // if they just finished) — "tap it, it goes last" always means last. It just
    // waits for the arrivals to stop first, together with everyone else tapped
    // in the same burst, so the board doesn't reshuffle under the commissaire's
    // eyes while they're still reading bibs off a bunch.
    holdPendingMove(rider.id, isFinished);

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
    dropPendingMove(rider.id);
    if (snapshot?.prevOrderIndex !== undefined) {
      const at = snapshot.prevOrderIndex;
      setDisplayOrder((prev) => {
        const rest = prev.filter((id) => id !== rider.id);
        const idx = Math.min(at, rest.length);
        return [...rest.slice(0, idx), rider.id, ...rest.slice(idx)];
      });
    }
    if (snapshot) setRiderActions((prev) => prev.filter((a) => a.id !== snapshot.id));

    if (race) {
      AuditLogService.log({
        race,
        action: "REVERT_LAP",
        screen: "Heat",
        entityType: "rider",
        entityId: rider.bibNumber,
        details: { lap: rider.lapsCounter },
      });
    }

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
      (a) => a.prevRider && !a.statusChange && a.prevRider.id === rider.id && a.rider.lapsCounter === rider.lapsCounter
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

    // A manual "Finish Race" adds no lap: undo is a straight restore of the exact
    // pre-finish snapshot, so every lap, time and position comes back untouched.
    if (action.statusChange === "FINISH") {
      if (!rider || !action.prevRider) return null;
      const restored = { ...action.prevRider };
      updateRider(restored);
      updateAllRiders(calculatePositions(riders.map((r) => (r.id === restored.id ? restored : r))));
      setRiderActions((prev) => prev.filter((a) => a.id !== actionId));
      setUndoneFinishes([action, ...undoneFinishes.filter((u) => u.id !== actionId)]);
      if (race) {
        AuditLogService.log({
          race, action: "CANCEL_ACTION", screen: "Heat", entityType: "rider",
          entityId: rider.bibNumber, details: { statusChange: "FINISH" },
        });
      }
      void recordRaceEvent({
        raceUuid, riderId: rider.id, bibNumber: rider.bibNumber, eventType: "UNDO",
        payload: {
          riderLocalId: rider.id,
          riderPatch: {
            raceStatus: restored.raceStatus, timeArrive: restored.timeArrive,
            elapsedTimeFromStart: restored.elapsedTimeFromStart,
            position_category: restored.position_category,
          },
        },
      });
      return rider;
    }

    // A DNF / DSQ / DNS entry: undo the classification, never a lap. Restore the
    // status the rider had before (older log entries without a snapshot go back
    // to racing, the same as the live screen's "Clear").
    if (action.statusChange === "DNF" || action.statusChange === "DSQ" || action.statusChange === "DNS") {
      if (!rider) return null;
      const restored: RiderProps = action.prevRider
        ? { ...rider, status: action.prevRider.status, raceStatus: action.prevRider.raceStatus }
        : { ...rider, status: "standing", raceStatus: "running" };
      updateRider(restored);
      setRiderActions((prev) => prev.filter((a) => a.id !== actionId));
      if (race) {
        AuditLogService.log({
          race, action: "CANCEL_ACTION", screen: "Heat", entityType: "rider",
          entityId: rider.bibNumber, details: { statusChange: action.statusChange },
        });
      }
      return restored;
    }

    if (!rider || rider.lapsCounter <= 0) return null;

    dropPendingMove(rider.id);

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

    if (race) {
      AuditLogService.log({
        race,
        action: "CANCEL_ACTION",
        screen: "Heat",
        entityType: "rider",
        entityId: rider.bibNumber,
        details: { statusChange: action.statusChange ?? "lap" },
      });
    }

    return rider;
  };

  /** Log a DNF/DSQ/DNS so it shows in the action log alongside laps. */
  const logStatusChange = (rider: RiderProps, status: "DNF" | "DSQ" | "DNS", prevRider?: RiderProps): void => {
    if (race) {
      AuditLogService.log({
        race,
        action: "STATUS_CHANGE",
        screen: "Heat",
        entityType: "rider",
        entityId: rider.bibNumber,
        after: { status },
      });
    }
    setRiderActions((prev) => [
      {
        id: `${rider.id}-status-${status}-${Date.now()}`,
        rider,
        prevRider,
        timestamp: Date.now(),
        source: "click",
        categoryColor: getCatColor(rider),
        statusChange: status,
      },
      ...prev,
    ]);
  };

  /**
   * Manually finish ONE rider (operator action from the rider menu). Stamps the
   * real finish time, keeps lapsCounter and lapsDetails exactly as recorded, and
   * touches nobody else — in particular it never raises the category-wide finish
   * flag, which requires a rider to have completed ALL laps (see linkedGroups).
   * Undo goes through `cancelAction` with the snapshot stored on the log entry.
   */
  const finishRider = (rider: RiderProps): boolean => {
    if (rider.raceStatus === "finished" || ["DNF", "DSQ", "DNS"].includes(rider.status)) return false;
    if (!canForRace(raceUuid, "MARK_LAP")) {
      toast.warn("No permission to finish riders");
      return false;
    }
    dropPendingMove(rider.id);
    const finishTime = new Date();
    const raceStart = parseClockTime(rider.timeStartRace) ?? finishTime;
    const finished: RiderProps = {
      ...rider,
      raceStatus: "finished",
      timeArrive: finishTime.toISOString(),
      elapsedTimeFromStart: formatTime((finishTime.getTime() - raceStart.getTime()) / 1000),
    };
    const sorted = calculatePositions(riders.map((r) => (r.id === finished.id ? finished : r)));
    const withPos: RiderProps = {
      ...finished,
      position_category: sorted.find((r) => r.id === rider.id)?.position_category ?? rider.position_category,
    };
    updateRider(withPos);
    updateAllRiders(sorted.map((r) => (r.id === withPos.id ? withPos : r)));

    if (race) {
      AuditLogService.log({
        race, action: "STATUS_CHANGE", screen: "Heat", entityType: "rider",
        entityId: rider.bibNumber, after: { status: "FINISH" },
      });
    }
    void recordRaceEvent({
      raceUuid, riderId: rider.id, bibNumber: rider.bibNumber, eventType: "RIDER_EDITED",
      lapNumber: rider.lapsCounter,
      payload: {
        riderLocalId: rider.id,
        riderPatch: {
          raceStatus: "finished", timeArrive: withPos.timeArrive,
          elapsedTimeFromStart: withPos.elapsedTimeFromStart,
          position_category: withPos.position_category,
        },
      },
    });

    const now = Date.now();
    setRiderActions((prev) => [
      {
        id: `${rider.id}-finish-${now}`,
        rider: withPos,
        prevRider: rider,
        timestamp: now,
        source: "click",
        categoryColor: getCatColor(rider),
        statusChange: "FINISH",
      },
      ...prev,
    ]);
    return true;
  };

  /** Undone finishes whose rider is still exactly as it was right after the undo. */
  const redoableFinishes = undoneFinishes.filter((u) => {
    const cur = riders.find((r) => r.id === u.rider.id);
    const prev = u.prevRider;
    return !!cur && !!prev && cur.lapsCounter === prev.lapsCounter && cur.raceStatus === prev.raceStatus &&
      cur.status === prev.status && cur.timeArrive === prev.timeArrive;
  });

  /**
   * Redo an undone manual finish: restores the stored post-finish snapshot, so the
   * original finish time/elapsed/position come back. Like the finish itself it never
   * touches any other rider. Refused once the rider has changed since the undo.
   */
  const redoFinish = (actionId: string): boolean => {
    const action = redoableFinishes.find((u) => u.id === actionId);
    if (!action) return false;
    if (!canForRace(raceUuid, "MARK_LAP")) {
      toast.warn("No permission to finish riders");
      return false;
    }
    dropPendingMove(action.rider.id);
    const restored = { ...action.rider };
    updateRider(restored);
    updateAllRiders(calculatePositions(riders.map((r) => (r.id === restored.id ? restored : r))));
    setUndoneFinishes(undoneFinishes.filter((u) => u.id !== actionId));
    setRiderActions((prev) => [{ ...action, rider: restored, timestamp: Date.now() }, ...prev.filter((a) => a.id !== actionId)]);
    void recordRaceEvent({
      raceUuid, riderId: restored.id, bibNumber: restored.bibNumber, eventType: "RIDER_EDITED",
      lapNumber: restored.lapsCounter,
      payload: {
        riderLocalId: restored.id,
        riderPatch: {
          raceStatus: "finished", timeArrive: restored.timeArrive,
          elapsedTimeFromStart: restored.elapsedTimeFromStart,
          position_category: restored.position_category,
        },
      },
    });
    return true;
  };

  /**
   * Clear pending timers — call from the component's unmount effect.
   *
   * MUST be a stable reference: the page wires it as
   * `useEffect(() => clearTimers, [clearTimers])`. If its identity changed each
   * render, that effect's cleanup would fire on EVERY render and kill the
   * board-hold timer before it elapsed — so tapped cards never moved to the end
   * (live regression). It only touches refs, so `[]` is safe.
   */
  const clearTimers = useCallback((): void => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (maxHoldTimerRef.current) clearTimeout(maxHoldTimerRef.current);
    pendingMoveRef.current.clear();
  }, []);

  return {
    riderActions,
    setRiderActions,
    flashingRiderId,
    /** Tapped, counted, and waiting for the board hold to expire. */
    pendingMoveIds,
    recordLap,
    revertLap,
    cancelAction,
    logStatusChange,
    finishRider,
    redoableFinishes,
    redoFinish,
    clearTimers,
  };
}
