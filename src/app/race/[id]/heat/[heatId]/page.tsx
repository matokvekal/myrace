import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styles from "./heat.module.css";
import { toast } from "react-toastify";
import HeaderHeats from "../../../components/headerHeat/HeaderHeat";
import Icons from "@/constants/Icons";
import RacingRider from "../../categories/racingRider/RacingRider";
import FinishRider from "../../categories/finishRider/FinishRider";
import useRaceStore from "@/stores/racesStore";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import { useVoiceSettingsStore } from "@/stores/voiceSettingsStore";
import { RiderProps } from "@/types/types";
import { formatTime, formatTimeWithLeadingZeroes, parseClockTime } from "../../../../utils/timeUtils";
import { useLapRecording } from "./useLapRecording";
import { minLapMsFor } from "@/utils/minLap";
import calculatePositions from "../../../../utils/calculatePosition";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES, riderInCategory, withCategoryLaps, getScheduleWaves } from "../../schedule/Schedule";
import useUIStore from "@/stores/uiStore";
import { computeGroupPhases, phaseOfRider, isLeaderFinishAll } from "@/utils/linkedGroups";
import RiderLiveModal from "./RiderLiveModal";
import { VoiceIndicator } from "@/components/voice/VoiceIndicator";
import { useVoiceRecognition } from "@/components/voice/useVoiceRecognition";
import { VoiceSettingsModal } from "./VoiceSettingsModal";
import { MicPermissionModal } from "@/components/voice/MicPermissionModal";
import { VoiceRadarIcon } from "@/components/voice/VoiceRadarIcon";
import { DetectedNumbers } from "@/components/voice/DetectedNumbers";
import { RiderActionLog } from "@/components/voice/RiderActionLog";
import { extractNumbers } from "@/utils/numberParser";
import { recordRaceEvent } from "@/services/cloud/raceEvents";
import { canForRace } from "@/services/cloud/permissions";
import useCloudRaceSync from "@/hooks/useCloudRaceSync";
import { useJokerMode } from "@/hooks/useJokerMode";
import { useBoardHold } from "@/stores/boardHoldStore";
import { useJokerQueue, type JokerEntry } from "./useJokerQueue";
import JokerCard from "./jokerCard/JokerCard";
import JokerResolveModal from "./JokerResolveModal";
import { jokerResolveBlock } from "./jokerResolve";
import { activeCategories, withoutIgnoredRiders } from "@/utils/ignoredWaves";
import { planWaveFinish } from "@/utils/waveFinish";
import { useRecapMode, RECAP_MIN_LAP_SECONDS } from "./useRecapMode";
import DeleteConfirmModal from "@/components/ui/DeleteConfirmModal";
import { Bike, List, ChevronDown } from "lucide-react";
import { canViewScreen, isLiveRace, liveAllows, liveDispatch } from "@/services/live/liveBridge";
import { AuditLogService } from "@/services/auditLog/auditLogService";
// Shared races: the sync state where it matters most (offline / waiting to send).
const SyncBadge = lazy(() => import("../../../../live/SyncBadge"));

// Category identity is name + subCategory: the same name can exist in several
// waves with different subcategories (e.g. Master Men 19-29 vs 30-49).
const catKey = (name: string, sub?: string | null) => `${name}|${sub ?? ""}`;
const riderCatKey = (r: { category: string; subCategory?: string | null }) =>
  catKey(r.category, r.subCategory);

const Heat: React.FC = () => {
  const { t } = useTranslation();
  const params = useParams();
  const navigate = useNavigate();
  const raceUuid = params?.id as string;
  const heatId = params?.heatId ? parseInt(params.heatId as string, 10) : null;

  const { races, getRaces } = useRaceStore();
  const { riders: storeRiders, getRiders, updateRider, updateAllRiders } = useRiderStore();
  const { categories: storeCategories, getCategories } = useCategoryStore();
  // Ignored waves take no part in Live: no cards, no laps, no positions (data kept).
  const categories = useMemo(() => activeCategories(storeCategories), [storeCategories]);
  const riders = useMemo(() => withoutIgnoredRiders(storeRiders, storeCategories), [storeRiders, storeCategories]);
  const { settings: voiceSettings } = useVoiceSettingsStore();

  // live cloud sync for this race (no-op when race is local-only)
  useCloudRaceSync(raceUuid);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterCats, setFilterCats] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(new Date());
  const [contextRider, setContextRider] = useState<RiderProps | null>(null);
  const [showWaveInfo, setShowWaveInfo] = useState(false);
  const [displayOrder, setDisplayOrder] = useState<number[]>([]);
  const [voiceActive, setVoiceActive] = useState(false);
  const [showMicPrompt, setShowMicPrompt] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [voiceAudioLevel, setVoiceAudioLevel] = useState(0);
  const [voiceIsListening, setVoiceIsListening] = useState(false);
  const [detectedNumbers, setDetectedNumbers] = useState<Array<{ bib: string; categoryColor?: string; timestamp: number }>>([]);
  const [showActionLog, setShowActionLog] = useState(false);
  // Voice buffer (BUGS.md voice assist modes): every recognized bib gets logged
  // here regardless of autoConfirm — newest first, capped at 30 — so the
  // commissaire can review who was called out even in assist mode, where
  // nothing gets recorded automatically.
  const [voiceLog, setVoiceLog] = useState<Array<{ bib: string; time: number }>>([]);
  const [showVoiceLog, setShowVoiceLog] = useState(false);
  const VOICE_LOG_LIMIT = 30;
  // Always-fresh refs so setTimeout callbacks can see latest store + handler
  const ridersRef = useRef(riders);
  const handleRiderClickRef = useRef<((rider: RiderProps, source?: 'click' | 'voice', at?: Date) => void) | null>(null);
  // Voice buffer: queue of pending bib detections + 30s cooldown map per bib
  const voiceQueueRef = useRef<Array<{ bib: string; detectedAt: number }>>([]);
  const bibCooldownRef = useRef<Map<string, number>>(new Map());
  const queueProcessingRef = useRef(false);
  const VOICE_COOLDOWN_MS = 30_000;

  useEffect(() => {
    if (!raceUuid) return;
    const fetchAllData = async () => {
      if (races.length === 0) await getRaces();
      await getCategories(raceUuid);
      await getRiders(raceUuid);
    };
    fetchAllData();
  }, [raceUuid, getRaces, getCategories, getRiders, races.length]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const currentRace = useMemo(() => races.find((r) => r.uuid === raceUuid), [races, raceUuid]);

  // A finalized race has no live screen — every tap here would be swallowed by
  // the store guards (utils/raceLock.ts). Bounce to the race, which opens on
  // Results. Covers the deep link / bookmark / back-button routes too, which is
  // why it lives here and not only behind the hidden Live button.
  useEffect(() => {
    if (currentRace?.finalized) navigate(`/race/${raceUuid}`, { replace: true });
  }, [currentRace?.finalized, navigate, raceUuid]);

  // Shared race: join its live room, and leave the screen if this member may not view Live.
  useEffect(() => {
    if (!isLiveRace(raceUuid)) return;
    if (!canViewScreen(raceUuid, "live")) {
      navigate(`/race/${raceUuid}`, { replace: true });
      return;
    }
    void import("@/services/live/liveClient").then((m) => m.openLiveRace(raceUuid));
  }, [raceUuid, navigate]);

  // treat race.distance as circuit km per lap (if set and reasonable)
  const circuitKm = currentRace?.distance && currentRace.distance > 0 ? currentRace.distance : null;

  const waveCategories = useMemo(() => {
    if (heatId == null || categories.length === 0) return categories;
    const schedule = buildSchedule(categories, DEFAULT_WAVE_GAP_MINUTES);
    const slotMap = schedule.get(heatId);
    if (slotMap) {
      const cats = [...slotMap.values()].flat();
      if (cats.length > 0) return cats;
    }
    return categories;
  }, [categories, heatId]);

  // Every wave in this race's schedule, for the wave-switch dropdown next to
  // the bib search — lets the commissaire jump to another wave without going
  // back through Setup/Race (user request).
  const scheduleWaves = useMemo(() => getScheduleWaves(categories), [categories]);
  const currentWave = useMemo(
    () => scheduleWaves.find((w) => w.waveNum === heatId),
    [scheduleWaves, heatId]
  );
  const handleWaveChange = (nextHeatId: number) => {
    if (nextHeatId === heatId) return;
    navigate(`/race/${raceUuid}/heat/${nextHeatId}`);
  };

  // Category filter list order: RUNNING first (the ones you're actively scoring),
  // then finished, then not-started LAST. Not-started categories have no cards on
  // Live, so they're shown greyed-out and can't be selected — you can only filter
  // to categories that have started (user request).
  const filterCategories = useMemo(() => {
    const rank = (status?: string) =>
      status === "running" ? 0 : status === "finished" ? 1 : 2;
    return [...waveCategories].sort((a, b) => rank(a.status) - rank(b.status));
  }, [waveCategories]);

  const filteredRiders = useMemo(
    () => {
      // Live shows only riders whose CATEGORY has actually started in this wave.
      // A category in the wave that hasn't been started yet must not show its
      // cards at all — even though it shares the wave (user request). Gating on
      // the category's own status (running/finished) is authoritative; the
      // rider-level `raceStatus` check alone let not-started cards leak on.
      // Matching is by name + subCategory so same-named categories in other
      // waves don't bleed in.
      const filtered = riders.filter(
        (r) =>
          r.raceUuid === raceUuid &&
          r.raceStatus !== "upcoming" &&
          waveCategories.some(
            (c) =>
              riderInCategory(r, c) &&
              (c.status === "running" || c.status === "finished")
          )
      );
      // Laps resolved from the category — the shared rule (BUGS.md #7)
      return withCategoryLaps(filtered, waveCategories);
    },
    [riders, raceUuid, waveCategories]
  );

  const getCatColor = (rider: RiderProps): string => {
    const cat = categories.find((c) => riderInCategory(rider, c));
    return cat?.color ?? rider.color ?? "#ccc";
  };

  // Gap to the category leader (position_category === 1), shown in the
  // double-tap detail modal only — reuses the ranking calculatePositions()
  // already assigns, so no extra sort here. Always a time diff ("+M:SS"),
  // never a lap count, even when the rider is a lap down (user req); "—" for
  // the leader themself.
  const getGapToLeader = (rider: RiderProps): string => {
    if (rider.position_category === 1) return "—";
    const cat = categories.find((c) => riderInCategory(rider, c));
    if (!cat) return "—";
    const leader = filteredRiders.find((r) => riderInCategory(r, cat) && r.position_category === 1);
    if (!leader) return "—";
    const leaderStart = parseClockTime(leader.timeStartRace);
    const riderStart = parseClockTime(rider.timeStartRace);
    if (!leaderStart || !riderStart) return "—";
    const leaderEnd = leader.timeArrive ? new Date(leader.timeArrive) : new Date();
    const riderEnd = rider.timeArrive ? new Date(rider.timeArrive) : new Date();
    const diffMs = (riderEnd.getTime() - riderStart.getTime()) - (leaderEnd.getTime() - leaderStart.getTime());
    if (!isFinite(diffMs) || diffMs <= 0) return "—";
    const s = Math.floor(diffMs / 1000);
    return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  // Bell / flag phases of each category or explicit Finish Group (shared with
  // the server engine: shared/race/finishPhases). Computed over the WHOLE race
  // (every started category), not just this wave, so a Finish Group spans
  // waves. Derived from recorded crossings only: undo and reload just recompute.
  const groupPhases = useMemo(() => {
    const started = categories.filter((c) => c.status === "running" || c.status === "finished");
    const raceRiders = riders.filter((r) => r.raceUuid === raceUuid && r.raceStatus !== "upcoming");
    return computeGroupPhases(started, withCategoryLaps(raceRiders, categories), isLeaderFinishAll(currentRace));
  }, [categories, riders, raceUuid, currentRace]);
  const phaseOf = (rider: RiderProps) => phaseOfRider(rider, categories, groupPhases);
  // The next crossing finishes this rider: their category was ended (Finish
  // Wave), or they show the FLAG (got the bell, or the group's first finish).
  const isOnTrackAfterEnd = (rider: RiderProps): boolean => {
    if (categories.find((c) => riderInCategory(rider, c))?.status === "finished") return true;
    return rider.raceStatus !== "finished" && phaseOf(rider).nextCrossingFinishes;
  };
  // The ON TRACK badge / count: only once the rider's category was actually ended
  // (Finish Wave / Finish Race) and they are still out — never during normal
  // racing, where the shared finish already shows as the chequered flag.
  const isLeftOnTrack = (rider: RiderProps): boolean =>
    rider.raceStatus !== "finished" &&
    categories.find((c) => riderInCategory(rider, c))?.status === "finished";


  // Persist the action log (and Joker queue) per wave so a mid-wave reload
  // restores every arrival (BUGS.md #2). Keyed by race + heat so waves never
  // share a log.
  const persistKey = heatId != null ? `${raceUuid}:heat:${heatId}` : null;

  // Joker button (side-menu opt-in): stamp an unidentified rider's arrival
  // time+order instantly, resolve it to a bib afterward.
  const { jokerEnabled } = useJokerMode();
  const { jokers, addJoker, removeJoker } = useJokerQueue(persistKey);
  const [resolvingJoker, setResolvingJoker] = useState<JokerEntry | null>(null);

  // How long the board stays frozen after a tap, so a bunch arriving together
  // doesn't reshuffle the cards while the bibs are still being read out.
  const boardHoldMs = useBoardHold((s) => s.holdMs);

  // Lap recording + rollback live in a dedicated hook (BUGS.md #29). Same rules
  // and side effects as before — this component just drives it.
  const recap = useRecapMode();
  const {
    riderActions,
    setRiderActions,
    flashingRiderId,
    pendingMoveIds,
    recordLap,
    revertLap,
    cancelAction,
    logStatusChange,
    finishRider,
    redoableFinishes,
    redoFinish,
    clearTimers,
  } = useLapRecording({
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
    // RECAP MODE: 6-minute duplicate check instead of the race's minimum.
    minLapMsOverride: recap.active ? RECAP_MIN_LAP_SECONDS * 1000 : undefined,
    // The voice path renders its own detected-number chip, so only the tap path
    // adds one here — exactly as before the extraction.
    onLapRecorded: (rider, catColor, source) => {
      if (source !== "voice") {
        setDetectedNumbers((prev) => [
          ...prev,
          { bib: String(rider.bibNumber), categoryColor: catColor, timestamp: Date.now() },
        ]);
      }
      setSearchTerm("");
    },
  });

  // A tap records at the moment of the tap (the card waits 300 ms to tell a
  // double-tap — rider history — from a single tap, and passes the tap time).
  // In RECAP MODE the same flow applies, with the 6-minute duplicate check.
  const handleRiderClick = (rider: RiderProps, source: 'click' | 'voice' = 'click', at?: Date) => {
    recordLap(rider, source, at);
  };

  const handleRevertLap = (rider: RiderProps) => {
    revertLap(rider);
    setContextRider(null);
  };

  // Keep refs in sync every render so async callbacks see fresh data
  ridersRef.current = riders;
  handleRiderClickRef.current = handleRiderClick;

  // Drain the voice queue: process each pending bib in order, skip cooldown duplicates
  const processVoiceQueue = () => {
    if (queueProcessingRef.current) return;
    queueProcessingRef.current = true;

    const processNext = () => {
      const entry = voiceQueueRef.current.shift();
      if (!entry) { queueProcessingRef.current = false; return; }

      const { bib } = entry;
      const now = Date.now();

      // 30-second cooldown: same bib already processed recently — skip silently
      const lastTime = bibCooldownRef.current.get(bib) ?? 0;
      if (now - lastTime < VOICE_COOLDOWN_MS) {
        processNext(); // skip, try next immediately
        return;
      }

      // Mark cooldown immediately so parallel queue entries for same bib are deduplicated
      bibCooldownRef.current.set(bib, now);

      const rider = ridersRef.current.find(
        (r) => r.raceUuid === raceUuid && String(r.bibNumber) === bib && r.raceStatus !== "finished"
      );

      if (rider) {
        const lapsBefore = rider.lapsCounter;
        const catColor = (() => {
          const cat = categories.find((c) => riderInCategory(rider, c));
          return cat?.color ?? rider.color ?? "#ccc";
        })();

        setDetectedNumbers((prev) => [
          ...prev,
          { bib, categoryColor: catColor, timestamp: now },
        ]);

        handleRiderClickRef.current?.(rider, 'voice');

        // Safety retry: if lap didn't register after 2s, try once more with fresh data
        setTimeout(() => {
          const fresh = ridersRef.current.find(
            (r) => r.raceUuid === raceUuid && String(r.bibNumber) === bib && r.raceStatus !== "finished"
          );
          if (fresh && fresh.lapsCounter === lapsBefore) {
            handleRiderClickRef.current?.(fresh, 'voice');
          }
        }, 2000);
      }

      // Small gap between queue items so rapid multi-bib utterances don't all hit at once
      setTimeout(processNext, 80);
    };

    processNext();
  };

  const handleStatusChange = (rider: RiderProps, status: RiderProps["status"]) => {
    const isOut = ["DNF", "DSQ", "DNS"].includes(status);
    if (isOut && !canForRace(raceUuid, status === "DNS" ? "MARK_DNS" : "MARK_DNF")) {
      toast.warn("No permission to change rider status");
      return;
    }
    const updatedRider: RiderProps = {
      ...rider,
      status,
      raceStatus: isOut ? "finished" : "running",
    };
    updateRider(updatedRider);

    if (isOut) {
      void recordRaceEvent({
        raceUuid,
        riderId: rider.id,
        bibNumber: rider.bibNumber,
        // DSQ rides on the DNF event type; the real status is in the patch
        eventType: status === "DNS" ? "DNS" : "DNF",
        payload: {
          riderLocalId: rider.id,
          riderPatch: { status: updatedRider.status, raceStatus: updatedRider.raceStatus },
        },
      });
    }

    // Add status change to action log for DNF/DSQ/DNS
    if (isOut) {
      logStatusChange(updatedRider, status as 'DNF' | 'DSQ' | 'DNS', rider);
    }

    setContextRider(null);
  };

  const handleSaveComment = (rider: RiderProps, comment: string) => {
    updateRider({ ...rider, comment });
  };

  const [showFilterPanel, setShowFilterPanel] = useState(false);

  // Clear state (BUGS.md #14): once a wave is fully stopped the commissaire can
  // wipe the live board to a clean 00:00:00 before the next wave. View-only —
  // rider results stay in the Results tab. Reset whenever the wave changes.
  const [clearedWave, setClearedWave] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    setClearedWave(false);
    setConfirmClear(false);
    // New wave — last wave's voice buffer is stale, don't carry it over
    setVoiceLog([]);
    setShowVoiceLog(false);
  }, [heatId]);

  // Started categories in this wave, and whether the wave has been stopped
  // (every started category finished). Drives both the frozen timer and the
  // Clear button's visibility.
  const startedWaveCats = useMemo(
    () => waveCategories.filter((c) => c.status === "running" || c.status === "finished"),
    [waveCategories]
  );
  const waveStopped = useMemo(
    () => startedWaveCats.length > 0 && startedWaveCats.every((c) => c.status === "finished"),
    [startedWaveCats]
  );

  // ── Finish Wave (manual, from Live) ── one rule with Race → Start (planWaveFinish):
  // only THIS wave; recorded laps and times kept; riders still racing become
  // administrative finishers (no invented crossing time). Idempotent.
  const [showFinishWave, setShowFinishWave] = useState(false);
  // RECAP MODE (useRecapMode, declared before useLapRecording): normal recording with a 6-minute duplicate check; ends after 30 s idle.
  useEffect(() => {
    if (!recap.active) return;
    const onActivity = () => recap.touch();
    document.addEventListener("pointerdown", onActivity);
    document.addEventListener("keydown", onActivity);
    return () => {
      document.removeEventListener("pointerdown", onActivity);
      document.removeEventListener("keydown", onActivity);
    };
  }, [recap.active, recap.touch]); // eslint-disable-line react-hooks/exhaustive-deps
  const exitRecap = () => recap.exit();
  // Leaving RECAP MODE (Exit, toggle or 30 s idle) restores normal Live: no review filter left on the board.
  const wasRecapRef = useRef(false);
  useEffect(() => {
    if (wasRecapRef.current && !recap.active) setSearchTerm("");
    wasRecapRef.current = recap.active;
  }, [recap.active]);

  const finishingWaveRef = useRef(false);
  const waveAllRiders = useMemo(
    () => riders.filter((r) => r.raceUuid === raceUuid && waveCategories.some((c) => riderInCategory(r, c))),
    [riders, raceUuid, waveCategories]
  );
  const waveStillRacing = waveAllRiders.filter((r) => r.raceStatus === "running" && !["DNF", "DSQ", "DNS"].includes(r.status)).length;
  const waveAllFinished = waveCategories.length > 0 && waveCategories.every((c) => c.status === "finished");
  const finishWaveFromLive = async () => {
    if (finishingWaveRef.current || waveAllFinished || heatId == null) return; // no double execution
    if (!liveAllows(raceUuid, "WaveFinished", { heat: heatId })) return;
    finishingWaveRef.current = true;
    try {
      const now = new Date();
      if (isLiveRace(raceUuid)) void liveDispatch(raceUuid, "WaveFinished", { heat: heatId });
      const plan = planWaveFinish(waveCategories, storeRiders, raceUuid, now);
      for (const cat of plan.categories) await useCategoryStore.getState().updateCategory(cat);
      if (plan.finalized.length > 0) await updateAllRiders(plan.finalized);
      if (plan.closedOut.length > 0) await updateAllRiders(plan.closedOut);
      if (currentRace) {
        AuditLogService.log({
          race: currentRace,
          action: "FINISH_WAVE",
          screen: "Live",
          entityType: "wave",
          entityId: heatId,
          details: {
            finishedAt: now.toISOString(),
            categories: plan.categories.map((c) => c.name),
            administrativelyFinished: plan.closedOut.map((r) => r.bibNumber),
            alreadyFinished: plan.finalized.map((r) => r.bibNumber),
          },
        });
      }
      toast.success(`Wave ${heatId} finished — ${plan.closedOut.length} rider${plan.closedOut.length === 1 ? "" : "s"} still racing marked as finished (administrative).`);
      setShowFinishWave(false);
    } finally {
      finishingWaveRef.current = false;
    }
  };

  const toggleCatFilter = (key: string) => {
    setFilterCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const catOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    waveCategories.forEach((cat, idx) => map.set(catKey(cat.name, cat.subCategory), idx));
    return map;
  }, [waveCategories]);

  // All non-finished riders for this heat, ignoring search/category filter — this is the
  // stable pool the manual queue (displayOrder) tracks, so typing in the search box never
  // reshuffles anyone's position.
  const runningRiders = useMemo(
    () => filteredRiders.filter((r) => r.raceStatus !== "finished"),
    [filteredRiders]
  );

  // Resolve a Joker (unidentified tap) to a real bib — records the lap as if
  // it happened at the moment the Joker was tapped, not now. Returns whether
  // it succeeded so the modal knows whether to close or let the commissaire retry.
  const resolveJoker = (joker: JokerEntry, bibNumber: number): boolean => {
    const candidate = runningRiders.find((r) => r.bibNumber === bibNumber);
    if (!candidate) {
      toast.error(`No active rider with bib ${bibNumber}`);
      return false;
    }
    // Refused before anything is recorded, so the Joker stays and no duplicate lap is made.
    const blocked = jokerResolveBlock(candidate, joker.capturedAt, minLapMsFor(races.find((r) => r.uuid === raceUuid)));
    if (blocked) {
      toast.error(blocked);
      return false;
    }
    recordLap(candidate, "click", new Date(joker.capturedAt));
    removeJoker(joker.id);
    toast.success(`Joker #${joker.sequence} → Bib ${bibNumber}`);
    return true;
  };

  const activeRiders = useMemo(() => {
    const catFiltered = filterCats.size > 0 ? runningRiders.filter((r) => filterCats.has(riderCatKey(r))) : runningRiders;
    const q = searchTerm.toLowerCase();
    return q
      ? catFiltered.filter(
          (r) =>
            r.firstName.toLowerCase().includes(q) ||
            r.lastName.toLowerCase().includes(q) ||
            String(r.bibNumber).includes(q)
        )
      : catFiltered;
  }, [runningRiders, searchTerm, filterCats]);

  // Seed brand-new riders into the manual queue (category then bib, as a starting point)
  // and drop anyone no longer running (finished/DNF/DSQ/DNS). Reordering itself only ever
  // happens explicitly, from a tap moving one id to the end — never from a bulk re-sort —
  // so "tap it, it goes last" always means the literal last position.
  const runningIdsKey = [...runningRiders.map((r) => r.id)].sort((a, b) => a - b).join(",");
  useEffect(() => {
    const stillRunning = new Set(runningRiders.map((r) => r.id));
    setDisplayOrder((prev) => {
      const kept = prev.filter((id) => stillRunning.has(id));
      const keptSet = new Set(kept);
      const newcomers = runningRiders
        .filter((r) => !keptSet.has(r.id))
        .sort((a, b) => {
          const catA = catOrderMap.get(riderCatKey(a)) ?? 999;
          const catB = catOrderMap.get(riderCatKey(b)) ?? 999;
          if (catA !== catB) return catA - catB;
          return a.bibNumber - b.bibNumber;
        })
        .map((r) => r.id);
      if (newcomers.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...newcomers];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningIdsKey]);

  // Cards tapped during the current board hold. They keep their place on the
  // board, so each one has to show that it registered — the drop to the bottom
  // used to be the only confirmation.
  const pendingMoveSet = useMemo(() => new Set(pendingMoveIds), [pendingMoveIds]);

  // Build displayed riders: stable order from displayOrder, live data from activeRiders
  const displayedRiders = useMemo(() => {
    if (clearedWave) return [] as RiderProps[];
    const riderMap = new Map(activeRiders.map((r) => [r.id, r]));
    const ordered: RiderProps[] = [];
    for (const id of displayOrder) {
      const r = riderMap.get(id);
      if (r) ordered.push(r);
      riderMap.delete(id);
    }
    // Any new riders not yet in displayOrder go at the end
    riderMap.forEach((r) => ordered.push(r));
    // "Still on track" riders (their category's race already ended) sink to the
    // bottom of the racing grid, next to Finished/DNF, so they don't sit between
    // the riders who are actively racing.
    const endedCats = new Set(
      categories.filter((c) => c.status === "finished").map((c) => catKey(c.name, c.subCategory))
    );
    if (endedCats.size === 0) return ordered;
    return [
      ...ordered.filter((r) => !endedCats.has(riderCatKey(r))),
      ...ordered.filter((r) => endedCats.has(riderCatKey(r))),
    ];
  }, [activeRiders, displayOrder, categories, clearedWave]);

  const finishedRiders = useMemo(() => {
    if (clearedWave) return [] as RiderProps[];
    const outOrder = (r: RiderProps) => {
      if (r.status === "DNF") return 1;
      if (r.status === "DSQ") return 2;
      if (r.status === "DNS") return 3;
      return 0;
    };
    return [...filteredRiders]
      .filter((r) => r.raceStatus !== "running" && (filterCats.size === 0 || filterCats.has(riderCatKey(r))))
      .sort((a, b) => {
        const oa = outOrder(a), ob = outOrder(b);
        if (oa !== ob) return oa - ob;
        return (a.position_category ?? 999) - (b.position_category ?? 999);
      });
  }, [filteredRiders, filterCats, clearedWave]);

  const validBibs = useMemo(() => {
    const set = new Set<string>();
    filteredRiders.forEach((r) => {
      if (r.raceStatus !== "finished") {
        set.add(String(r.bibNumber));
      }
    });
    return set;
  }, [filteredRiders]);

  const { isListening, lastTranscript, onDevice: voiceOnDevice } = useVoiceRecognition({
    language: voiceSettings.language,
    validBibs,
    commands: [],
    onBibDetected: (bib) => {
      // Every recognized bib lands in the buffer, whether or not it also
      // gets auto-recorded — this is the only path that fires for a heard
      // bib, so logging here (not inside processVoiceQueue) means the
      // buffer reflects exactly what the mic actually caught.
      setVoiceLog((prev) => [{ bib, time: Date.now() }, ...prev].slice(0, VOICE_LOG_LIMIT));

      // Assist mode (autoConfirm off): buffer only, nothing auto-records —
      // the commissaire reviews the list and taps riders in manually.
      if (!voiceSettings.autoConfirm) return;

      // Active mode: push into record queue; processor handles cooldown + dedup + retry
      voiceQueueRef.current.push({ bib, detectedAt: Date.now() });
      processVoiceQueue();
    },
    onCommand: (action) => {
      if (action === 'cancel') {
        setSearchTerm("");
      }
    },
    enabled: voiceActive && voiceSettings.enabled,
  });

  useEffect(() => {
    setVoiceIsListening(isListening);
  }, [isListening]);

  // Its toggle button only exists while voice is on — close the panel along
  // with it so it can't get stuck open with no way to dismiss it.
  useEffect(() => {
    if (!voiceActive) setShowVoiceLog(false);
  }, [voiceActive]);

  // Cleanup timers on unmount (the hook owns them)
  useEffect(() => clearTimers, [clearTimers]);

  // Auto-clear detected numbers after 3 seconds
  useEffect(() => {
    if (detectedNumbers.length > 0) {
      const timer = setTimeout(() => {
        setDetectedNumbers([]);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [detectedNumbers.length]);

  const elapsedTime = useMemo(() => {
    if (clearedWave) return "00:00:00";

    // Wave start = earliest actual rider start in this wave. Use timeStartRace
    // from ANY started rider (not just currently-running) so the clock survives
    // the wave being stopped, when every rider flips to "finished" (BUGS.md #14).
    const startMsList = filteredRiders
      .map((r) => parseClockTime(r.timeStartRace)?.getTime())
      .filter((t): t is number => t != null);
    if (startMsList.length === 0) return "00:00:00";
    const startMs = Math.min(...startMsList);

    // If the wave has been stopped, FREEZE at the stop moment (the latest
    // category finishedAt) instead of resetting to 0.
    const endMs = waveStopped
      ? Math.max(...startedWaveCats.map((c) => c.finishedAt ?? now.getTime()))
      : now.getTime();

    return formatTimeWithLeadingZeroes(Math.max(0, endMs - startMs) / 1000);
  }, [filteredRiders, now, clearedWave, waveStopped, startedWaveCats]);

  // Fastest / average lap for the wave (dopamine strip between the filter row
  // and the racing grid). Lap 1 is excluded on purpose: the start line rarely
  // sits exactly on the lap-timing point, so the first crossing can be short
  // or long versus every full lap after it — only laps 2+ are comparable.
  const lapStats = useMemo(() => {
    const pool = filterCats.size > 0 ? filteredRiders.filter((r) => filterCats.has(riderCatKey(r))) : filteredRiders;
    let fastestMs: number | null = null;
    let sumMs = 0;
    let count = 0;
    pool.forEach((r) => {
      (r.lapsDetails ?? []).forEach((d) => {
        if (d.lap <= 1) return;
        const ms = new Date(d.endTime).getTime() - new Date(d.startTime).getTime();
        if (!Number.isFinite(ms) || ms <= 0) return;
        if (fastestMs == null || ms < fastestMs) fastestMs = ms;
        sumMs += ms;
        count += 1;
      });
    });
    return {
      fastestMs,
      fastest: fastestMs != null ? formatTime(fastestMs / 1000) : null,
      average: count > 0 ? formatTime(sumMs / count / 1000) : null,
    };
  }, [filteredRiders, filterCats]);

  // Brief celebratory flash whenever the wave's fastest lap improves. Guarded
  // with `hasMountedFastLap` so hydrating an in-progress wave on load/reload
  // doesn't fire the flash for laps that were already on the board.
  const [newFastLap, setNewFastLap] = useState(false);
  const prevFastestMsRef = useRef<number | null>(null);
  const hasMountedFastLapRef = useRef(false);
  useEffect(() => {
    const prev = prevFastestMsRef.current;
    const next = lapStats.fastestMs;
    prevFastestMsRef.current = next;
    if (!hasMountedFastLapRef.current) {
      hasMountedFastLapRef.current = true;
      return;
    }
    if (next != null && (prev == null || next < prev)) {
      setNewFastLap(true);
      const t = setTimeout(() => setNewFastLap(false), 1200);
      return () => clearTimeout(t);
    }
  }, [lapStats.fastestMs]);

  // Turn voice on/off. When turning on, make sure we have mic permission first,
  // showing a friendly pre-prompt before the browser's native permission dialog.
  const handleToggleVoice = async () => {
    if (voiceActive) {
      setVoiceActive(false);
      return;
    }
    // If the browser already reports mic access, skip straight to listening.
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      if (status?.state === 'granted') {
        setVoiceActive(true);
        return;
      }
    } catch {
      /* Permissions API not available (e.g. Safari) — fall through to prompt. */
    }
    setShowMicPrompt(true);
  };

  return (
    <div className={`${styles.heat} ${recap.active ? styles.heatRecap : ""}`} data-recap-mode={recap.active ? "on" : undefined}>
      <HeaderHeats raceId={raceUuid} onSettingsClick={() => setShowVoiceSettings(true)} />
      {isLiveRace(raceUuid) && (
        <Suspense fallback={null}>
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 12px 0" }}>
            <SyncBadge raceUuid={raceUuid} />
          </div>
        </Suspense>
      )}

      {/* Rider detail modal (double-click) */}
      {contextRider && (
        <RiderLiveModal
          rider={contextRider}
          catColor={getCatColor(contextRider)}
          gapToLeader={getGapToLeader(contextRider)}
          onClose={() => setContextRider(null)}
          onRevertLap={handleRevertLap}
          onStatusChange={handleStatusChange}
          onFinishRace={finishRider}
          onSaveComment={handleSaveComment}
        />
      )}

      {showFinishWave && heatId != null && (
        <DeleteConfirmModal
          title={`Finish Wave ${heatId}?`}
          description={`Wave ${heatId}: ${waveAllRiders.length} rider${waveAllRiders.length === 1 ? "" : "s"}, ${waveStillRacing} still racing. All remaining active riders in this wave will be marked as finished (administrative — no finish time is invented; their recorded laps and times are kept). Other waves are not affected.`}
          confirmWord="FINISH"
          confirmLabel="Finish Wave"
          busyLabel="Finishing…"
          onConfirm={finishWaveFromLive}
          onCancel={() => setShowFinishWave(false)}
        />
      )}

      {/* Joker resolve modal — assign a bib to an unidentified stamped tap */}
      {resolvingJoker && (
        <JokerResolveModal
          joker={resolvingJoker}
          riders={filteredRiders}
          onSave={(bib) => resolveJoker(resolvingJoker, bib)}
          onDelete={() => removeJoker(resolvingJoker.id)}
          onClose={() => setResolvingJoker(null)}
        />
      )}

      {/* Voice settings modal */}
      {showVoiceSettings && (
        <VoiceSettingsModal
          onClose={() => setShowVoiceSettings(false)}
          voiceOnDevice={voiceActive && voiceSettings.enabled ? voiceOnDevice : null}
          leaderFinishAll={isLeaderFinishAll(currentRace)}
          onLeaderFinishAllChange={
            currentRace && !currentRace.finalized
              ? (on) => void useRaceStore.getState().updateRace({ ...currentRace, leaderFinishAll: on })
              : undefined
          }
          canClearBoard={waveStopped && !clearedWave}
          onClearBoard={() => {
            setShowVoiceSettings(false);
            setConfirmClear(true);
          }}
        />
      )}

      {/* Microphone permission pre-prompt */}
      {showMicPrompt && (
        <MicPermissionModal
          onGranted={() => {
            setShowMicPrompt(false);
            setVoiceActive(true);
          }}
          onClose={() => setShowMicPrompt(false)}
        />
      )}

      {/* Wave info modal */}
      {showWaveInfo && (
        <div className={styles.contextOverlay} onClick={() => setShowWaveInfo(false)}>
          <div className={styles.waveModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.waveModalHeader}>
              <span>Wave {heatId}</span>
              <button className={styles.contextClose} onClick={() => setShowWaveInfo(false)}>✕</button>
            </div>
            {waveCategories.map((cat) => (
              <div key={cat.id} className={styles.waveModalRow}>
                <span className={styles.catDot} style={{ background: cat.color ?? "#ccc" }} />
                <span className={styles.waveModalName}>{cat.name}{cat.subCategory ? ` · ${cat.subCategory}` : ""}</span>
                {cat.laps && <span className={styles.waveModalLaps}>{cat.laps} laps</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Clear-board confirmation (BUGS.md #14) */}
      {confirmClear && (
        <div className={styles.contextOverlay} onClick={() => setConfirmClear(false)}>
          <div className={styles.waveModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.waveModalHeader}>
              <span>Clear the board?</span>
              <button className={styles.contextClose} onClick={() => setConfirmClear(false)}>✕</button>
            </div>
            <p className={styles.clearConfirmText}>
              This resets the timer to 00:00:00 and removes every rider card from the
              live view. Race results are kept in the Results tab.
            </p>
            <div className={styles.clearConfirmActions}>
              <button className={styles.clearCancelBtn} onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
              <button
                className={styles.clearConfirmBtn}
                onClick={() => {
                  setClearedWave(true);
                  setConfirmClear(false);
                  // Wave's stopped — this wave's voice buffer is done too
                  setVoiceLog([]);
                  setShowVoiceLog(false);
                }}
              >
                Clear board
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.wrapper}>
        {/* Control panel: clock, wave info, Joker and bib search, grouped
            into one elevated card so this reads as a single distinct zone
            between the header and the racing grid. */}
        <div className={`${styles.controlPanel} ${recap.active ? styles.controlPanelRecap : ""}`}>
          {recap.active && (
            <div className={styles.recapBanner} role="status" data-testid="recap-mode-banner">
              <span className={styles.recapBannerTitle}>RECAP ACTIVE</span>
              <span className={styles.recapBannerHint}>
                Passages are recorded as usual, with a 6-minute duplicate check · ends after 30 s idle
              </span>
              <button type="button" className={styles.recapExit} onClick={exitRecap} data-testid="recap-exit">
                Exit RECAP
              </button>
            </div>
          )}
          {/* Timer row with wave-info button: which wave is live + its started categories */}
          <div className={styles.timerRow}>
            {/* Rider action log — lives in the timer row's empty left column so it
                scrolls/reflows with the clock and wave chip instead of floating
                over them on its own fixed coordinates. */}
            <div className={styles.logSlot}>
              <RiderActionLog
                actions={riderActions}
                isOpen={showActionLog}
                onToggle={() => setShowActionLog(!showActionLog)}
                onCancel={(actionId, riderName) => {
                  // The hook owns the undo: exact snapshot restore, queue slot restore,
                  // and cancelling any pending drop-to-end (BUGS.md #10, #29).
                  if (!cancelAction(actionId)) return;
                  toast.success(`Cancelled: ${riderName}`);
                }}
              />
            </div>
            {redoableFinishes.length > 0 && (
              <button
                type="button"
                className={styles.waveInfoBtn}
                data-testid="redo-finish"
                title="Redo the finish you just undid"
                onClick={() => {
                  const a = redoableFinishes[0];
                  if (redoFinish(a.id)) toast.success(`Finish restored: #${a.rider.bibNumber} ${a.rider.firstName} ${a.rider.lastName}`);
                }}
              >
                ↷ Redo finish #{redoableFinishes[0].rider.bibNumber}
              </button>
            )}
            <p className={styles.timerText}>{elapsedTime}</p>
            <button className={styles.waveInfoBtn} onClick={() => setShowWaveInfo(true)} title="Wave info">
              {heatId != null && <span className={styles.waveInfoLabel}>Wave {heatId}</span>}
              {waveCategories
                .filter((c) => c.status === "running" || c.status === "finished")
                .slice(0, 4)
                .map((cat) => (
                  <span key={cat.id} className={styles.miniDot} style={{ background: cat.color ?? "#ccc" }} />
                ))}
            </button>
          </div>

          {/* Entry row: Unknown Rider · bib (prominent) · RECAP MODE */}
          <div className={styles.entryRow}>
            {jokerEnabled && (
              <button
                className={styles.jokerBtn}
                onClick={addJoker}
                aria-label="Unknown Rider"
                title="Unknown Rider"
                data-testid="unknown-rider-btn"
              >
                <Bike size={22} aria-hidden="true" />
                <span className={styles.jokerQ} aria-hidden="true">?</span>
                {jokers.length > 0 && <span className={styles.jokerBadge}>{jokers.length}</span>}
              </button>
            )}
            <div className={`${styles.inputContainer} ${styles.bibEntry}`}>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={5}
                className={styles.searchInput}
                placeholder="#"
                aria-label="Bib"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => {
                  // Enter records the rider with exactly this bib (same flow and duplicate check as a tap).
                  if (e.key !== "Enter") return;
                  const hit = activeRiders.find((r) => String(r.bibNumber) === searchTerm.trim());
                  if (hit) handleRiderClick(hit, "click", new Date());
                  else if (searchTerm.trim()) toast.info(`No racing rider with bib ${searchTerm.trim()}`);
                }}
              />
              {searchTerm ? (
                <button className={styles.clearSearch} onClick={() => setSearchTerm("")} aria-label="Clear bib">✕</button>
              ) : (
                <img src={Icons.search} alt="" width={16} height={16} className={styles.inputIcon} />
              )}
            </div>
            <button
              type="button"
              className={`${styles.recapBtn} ${recap.active ? styles.recapOn : ""}`}
              aria-pressed={recap.active}
              data-testid="recap-btn"
              onClick={() => (recap.active ? exitRecap() : recap.enter())}
              title={recap.active ? "Exit RECAP" : "RECAP: record with a 6-minute duplicate check (ends after 30 s idle)"}
            >
              RECAP
            </button>
          </div>

          {/* Wave row, apart from timing entry: switch wave · Finish Wave */}
          <div className={styles.waveRow}>
            <div className={styles.waveRowStart}>
                {scheduleWaves.length > 1 && (
                  <label className={styles.waveSwitcher} title="Switch wave">
                    <span className={styles.waveSwitcherLabel}>Wave</span>
                    <span
                      className={[
                        styles.waveSwitcherDot,
                        currentWave?.status === "running" ? styles.waveSwitcherDotRunning : "",
                        currentWave?.status === "finished" ? styles.waveSwitcherDotFinished : "",
                      ].join(" ")}
                      aria-hidden="true"
                    />
                    <span className={styles.waveSwitcherValue}>
                      {currentWave ? currentWave.waveNum : heatId}
                    </span>
                    <select
                      className={styles.waveSwitcherSelect}
                      value={heatId ?? ""}
                      onChange={(e) => handleWaveChange(Number(e.target.value))}
                      aria-label="Switch wave"
                    >
                      {scheduleWaves.map((w) => (
                        <option key={w.waveNum} value={w.waveNum}>
                          Wave {w.waveNum}
                          {w.startTime ? ` · ${w.startTime}` : ""}
                          {w.status === "finished" ? " (done)" : ""}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className={styles.waveSwitcherChevron} aria-hidden="true" />
                  </label>
                )}
            </div>
            {waveCategories.length > 0 && (
              waveAllFinished ? (
                <span className={styles.waveFinishedTag} data-testid="wave-finished-tag">Wave {heatId} · Finished</span>
              ) : (
                <button
                  type="button"
                  className={styles.finishWaveBtn}
                  data-testid="finish-wave-btn"
                  disabled={startedWaveCats.length === 0}
                  title={startedWaveCats.length === 0 ? "This wave has not started" : "Finish this wave now"}
                  onClick={() => setShowFinishWave(true)}
                >
                  Finish Wave {heatId}
                </button>
              )
            )}
          </div>
        </div>

        {/* Filter panel popup */}
        {showFilterPanel && (
          <div className={styles.filterPanelOverlay} onClick={() => setShowFilterPanel(false)}>
            <div className={styles.filterPanel} onClick={(e) => e.stopPropagation()}>
              <div className={styles.filterPanelHeader}>
                <span>{t("heat.filterCategories", "Filter Categories")}</span>
                <button className={styles.contextClose} onClick={() => setShowFilterPanel(false)}>✕</button>
              </div>
              <label className={styles.filterPanelRow}>
                <input
                  type="checkbox"
                  checked={filterCats.size === 0}
                  onChange={() => setFilterCats(new Set())}
                />
                <span>{t("heat.allCategories", "All categories")}</span>
              </label>
              <div className={styles.filterDivider} />
              {filterCategories.map((cat) => {
                const running = cat.status === "running";
                const finished = cat.status === "finished";
                const notStarted = !running && !finished;
                const key = catKey(cat.name, cat.subCategory);
                return (
                  <label
                    key={cat.id}
                    className={`${styles.filterPanelRow} ${notStarted ? styles.filterRowNotStarted : ""} ${finished ? styles.filterRowFinished : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={filterCats.has(key)}
                      disabled={notStarted}
                      onChange={() => toggleCatFilter(key)}
                    />
                    <span className={styles.catDot} style={{ background: cat.color ?? "#ccc" }} />
                    <span>{cat.name}{cat.subCategory ? ` · ${cat.subCategory}` : ""}</span>
                    {notStarted && <span className={styles.filterStatusTag}>{t("heat.notStarted", "not started")}</span>}
                    {finished && <span className={styles.filterStatusTagDone}>{t("heat.finished", "finished")}</span>}
                    {cat.laps && <span className={styles.filterLapTag}>{cat.laps}L</span>}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className={styles.gridWrapper}>
          <div className={styles.info}>
            <div className={styles.active}>
              Racing ({activeRiders.length})
              {filterCats.size > 0 && (
                <span className={styles.filterActive}> · {filterCats.size} filtered</span>
              )}
              {(() => {
                const onTrack = runningRiders.filter(isLeftOnTrack).length;
                return onTrack > 0 ? (
                  <span
                    className={styles.onTrackTotal}
                    title="Riders still on the track after their race ended — don't forget them"
                  >
                    ⚑ {onTrack} still on track
                  </span>
                ) : null;
              })()}
            </div>
            {/* Fastest / average lap — dopamine feedback, inline so it doesn't
                cost its own row. Lap 1 excluded (see lapStats memo). */}
            {(lapStats.fastest || lapStats.average) && (
              <div className={styles.lapStatsInline}>
                <span className={`${styles.lapStatChip} ${newFastLap ? styles.lapStatPulse : ""}`}>
                  <span className={styles.lapStatChipLabel}>⚡ Fastest</span>
                  <span className={styles.lapStatChipValue}>{lapStats.fastest ?? "—"}</span>
                </span>
                <span className={styles.lapStatChip}>
                  <span className={styles.lapStatChipLabel}>Avg lap</span>
                  <span className={styles.lapStatChipValue}>{lapStats.average ?? "—"}</span>
                </span>
              </div>
            )}
            <button
              className={`${styles.filterIconBtn} ${filterCats.size > 0 ? styles.filterIconActive : ""}`}
              onClick={() => setShowFilterPanel(true)}
              title={t("heat.filterCategoriesTitle", "Filter categories")}
            >
              {filterCats.size > 0
                ? t("heat.filterCount", "Filter ({{count}})", { count: filterCats.size })
                : t("heat.filter", "Filter")}
            </button>
          </div>

          <div className={styles.ridersWrapper}>
            <div className={styles.riderGrid}>
              {displayedRiders.map((rider) => (
                <RacingRider
                  key={rider.id}
                  rider={rider}
                  color={getCatColor(rider)}
                  phase={phaseOf(rider)}
                  isFlashing={flashingRiderId === rider.id}
                  isRecorded={pendingMoveSet.has(rider.id)}
                  raceEnded={isLeftOnTrack(rider)}
                  onClick={(at) => handleRiderClick(rider, "click", at)}
                  onDoubleClick={() => setContextRider(rider)}
                />
              ))}
            </div>

            {jokerEnabled && jokers.length > 0 && (
              <>
                <div className={styles.finishers}>🃏 Unresolved ({jokers.length})</div>
                <div className={styles.riderGrid}>
                  {jokers.map((joker) => (
                    <JokerCard
                      key={joker.id}
                      joker={joker}
                      onClick={() => setResolvingJoker(joker)}
                    />
                  ))}
                </div>
              </>
            )}

            {finishedRiders.length > 0 && (
              <>
                <div className={styles.finishers}>Finished ({finishedRiders.length})</div>
                <div className={styles.riderGrid}>
                  {finishedRiders.map((finisher) => (
                    <FinishRider
                      key={finisher.id}
                      rider={finisher}
                      color={getCatColor(finisher)}
                      onDoubleClick={() => setContextRider(finisher)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Voice debug panel — active/auto-confirm mode only. In assist mode it
          just covers rider cards for no benefit, since nothing auto-records
          anyway; the new voice-buffer panel is the assist-mode equivalent. */}
      {voiceActive && voiceSettings.autoConfirm && (
        <div className={styles.voiceDebug}>
          <div className={styles.voiceDebugRow}>
            <span className={styles.voiceDebugLabel}>status:</span>
            <span className={`${styles.voiceDebugValue} ${voiceIsListening ? styles.green : styles.red}`}>
              {voiceIsListening ? 'listening' : 'not connected'}
            </span>
          </div>
          <div className={styles.voiceDebugRow}>
            <span className={styles.voiceDebugLabel}>lang:</span>
            <span className={styles.voiceDebugValue}>{voiceSettings.language === 'en' ? 'en-US' : 'he-IL'}</span>
          </div>
          <div className={styles.voiceDebugRow}>
            <span className={styles.voiceDebugLabel}>heard:</span>
            <span className={`${styles.voiceDebugValue} ${lastTranscript ? styles.yellow : ''}`}>
              {lastTranscript || '—'}
            </span>
          </div>
          {(() => {
            const nums = extractNumbers(lastTranscript, voiceSettings.language);
            const matchedNums = nums.filter(n => validBibs.has(String(n)));
            const unmatchedNums = nums.filter(n => !validBibs.has(String(n)));
            return (
              <>
                <div className={styles.voiceDebugRow}>
                  <span className={styles.voiceDebugLabel}>parsed:</span>
                  <span className={`${styles.voiceDebugValue} ${nums.length > 0 ? styles.yellow : ''}`}>
                    {lastTranscript ? (nums.join(', ') || 'no number') : '—'}
                  </span>
                </div>
                <div className={styles.voiceDebugRow}>
                  <span className={styles.voiceDebugLabel}>match:</span>
                  <span className={`${styles.voiceDebugValue} ${nums.length > 0 ? (matchedNums.length > 0 ? styles.green : styles.red) : ''}`}>
                    {nums.length === 0 ? '—'
                      : matchedNums.length > 0
                        ? `✓ ${matchedNums.join(', ')}${unmatchedNums.length > 0 ? ` | skip: ${unmatchedNums.join(', ')}` : ''}`
                        : `no match (${validBibs.size} active)`}
                  </span>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Floating mic button and voice indicator */}
      <div className={styles.voiceContainer}>
        {voiceActive && <VoiceIndicator isListening={isListening} lastTranscript={lastTranscript} />}

        <div className={styles.controlRow}>
          <div className={styles.numbersContainer}>
            {detectedNumbers.length > 0 && <DetectedNumbers numbers={detectedNumbers} />}
          </div>

          {/* Mic + voice-buffer toggle stay side by side as a pair even when
              .controlRow stacks to a column on narrow phones — this row never
              wraps to vertical on its own. */}
          <div className={styles.micRow}>
            <button
              className={styles.micButtonRadar}
              onClick={handleToggleVoice}
              title={voiceActive ? "Disable voice input" : "Enable voice input"}
            >
              <VoiceRadarIcon
                isActive={voiceActive}
                audioLevel={voiceAudioLevel}
                isListening={voiceIsListening}
              />
            </button>

            {/* Voice buffer toggle — every heard bib lands here (assist mode's
                only output; active mode logs it too, alongside the real record).
                Only exists once voice is actually on — nothing to show before that. */}
            {voiceActive && (
              <button
                className={`${styles.voiceLogBtn} ${showVoiceLog ? styles.voiceLogBtnActive : ""}`}
                onClick={() => setShowVoiceLog((v) => !v)}
                aria-label="Voice buffer"
                title="Show bibs heard by voice"
              >
                <List size={24} aria-hidden="true" />
                {voiceLog.length > 0 && <span className={styles.voiceLogBadge}>{voiceLog.length}</span>}
              </button>
            )}
          </div>
        </div>

        {showVoiceLog && (
          <div className={styles.voiceLogPanel}>
            <div className={styles.voiceLogPanelTitle}>Heard ({voiceLog.length})</div>
            {voiceLog.length === 0 ? (
              <div className={styles.voiceLogEmpty}>Nothing yet</div>
            ) : (
              voiceLog.map((entry, i) => (
                <div key={`${entry.time}-${i}`} className={styles.voiceLogRow}>
                  <span className={styles.voiceLogBib}>#{entry.bib}</span>
                  <span className={styles.voiceLogTime}>
                    {new Date(entry.time).toLocaleTimeString('en-GB', { hour12: false })}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Heat;
