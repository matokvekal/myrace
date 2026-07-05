import React, { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
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
import { formatTime, formatTimeWithLeadingZeroes } from "../../../../utils/timeUtils";
import calculatePositions from "../../../../utils/calculatePosition";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES } from "../../schedule/Schedule";
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

function parseTimeStr(t: string | null | undefined): Date | null {
  if (!t) return null;
  if (t.includes("T")) return new Date(t);
  const today = new Date();
  const [h, m, s = 0] = t.split(":").map(Number);
  today.setHours(h, m, s, 0);
  return today;
}

const MIN_LAP_MS = 60 * 1000; // 1 minute minimum between laps

const Heat: React.FC = () => {
  const params = useParams();
  const raceUuid = params?.id as string;
  const heatId = params?.heatId ? parseInt(params.heatId as string, 10) : null;

  const { races, getRaces } = useRaceStore();
  const { riders, getRiders, updateRider, updateAllRiders } = useRiderStore();
  const { categories, getCategories } = useCategoryStore();
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
  const [riderActions, setRiderActions] = useState<Array<{ id: string; rider: RiderProps; timestamp: number; source: 'click' | 'voice'; categoryColor: string; statusChange?: 'DNF' | 'DSQ' | 'DNS' }>>([]);
  const [showActionLog, setShowActionLog] = useState(false);
  const [flashingRiderId, setFlashingRiderId] = useState<number | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-fresh refs so setTimeout callbacks can see latest store + handler
  const ridersRef = useRef(riders);
  const handleRiderClickRef = useRef<((rider: RiderProps, source?: 'click' | 'voice') => void) | null>(null);
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
  // treat race.distance as circuit km per lap (if set and reasonable)
  const circuitKm = currentRace?.distance && currentRace.distance > 0 ? currentRace.distance : null;

  const heatCategories = useMemo(() => {
    if (heatId == null || categories.length === 0) return categories.map((c) => c.name);
    const schedule = buildSchedule(categories, DEFAULT_WAVE_GAP_MINUTES);
    const slotMap = schedule.get(heatId);
    if (slotMap) {
      const names = [...slotMap.values()].flat().map((c) => c.name);
      if (names.length > 0) return names;
    }
    return categories.map((c) => c.name);
  }, [categories, heatId]);

  const waveCategories = useMemo(
    () => categories.filter((c) => heatCategories.includes(c.name)),
    [categories, heatCategories]
  );

  const filteredRiders = useMemo(
    () => {
      const filtered = riders.filter((r) => r.raceUuid === raceUuid && heatCategories.includes(r.category));
      // Enrich riders with totalLaps from their category
      return filtered.map((rider) => {
        const cat = categories.find((c) => c.name === rider.category);
        return cat && cat.laps ? { ...rider, totalLaps: cat.laps } : rider;
      });
    },
    [riders, raceUuid, heatCategories, categories]
  );

  const getCatColor = (rider: RiderProps): string => {
    const cat = categories.find((c) => c.name === rider.category);
    return cat?.color ?? rider.color ?? "#ccc";
  };

  const handleRiderClick = (rider: RiderProps, source: 'click' | 'voice' = 'click') => {
    if ((rider.totalLaps > 0 && rider.lapsCounter >= rider.totalLaps) || rider.raceStatus === "finished") return;

    if (!canForRace(raceUuid, "MARK_LAP")) {
      toast.warn("No permission to mark laps");
      return;
    }

    const clickTime = new Date();

    // Prevent duplicate actions within 500ms (debounce rapid clicks/voice detections)
    if (lastActionRef.current && lastActionRef.current.riderId === rider.id) {
      const timeSinceLastAction = clickTime.getTime() - lastActionRef.current.timestamp;
      if (timeSinceLastAction < 500) {
        return; // Ignore duplicate action
      }
    }

    // Enforce 1-minute minimum between laps
    if (rider.timeArrive) {
      const msSinceLast = clickTime.getTime() - new Date(rider.timeArrive).getTime();
      if (msSinceLast < MIN_LAP_MS) {
        const remaining = Math.ceil((MIN_LAP_MS - msSinceLast) / 1000);
        toast.info(`Wait ${remaining}s before next lap`);
        return;
      }
    }

    const lapsCounter = (rider.lapsCounter || 0) + 1;
    const raceStart = parseTimeStr(rider.timeStartRace) ?? clickTime;
    const lastLapStart = rider.timeArrive ? new Date(rider.timeArrive) : raceStart;
    const lapMs = clickTime.getTime() - lastLapStart.getTime();
    const lapTime = formatTime(lapMs / 1000);
    const isFinished = rider.totalLaps > 0 && lapsCounter >= rider.totalLaps;
    const speed_kph = circuitKm
      ? Math.round((circuitKm / (lapMs / 3600000)) * 10) / 10
      : undefined;

    // Build intermediate rider to run calculatePositions and get accurate position
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

    // Final rider: include position and speed in the new lap detail
    const updatedRider: RiderProps = {
      ...intermediateRider,
      position_category: positionAtLap,
      lapsDetails: [
        ...(rider.lapsDetails ?? []),
        { lap: lapsCounter, startTime: lastLapStart, endTime: clickTime, lapTime, position: positionAtLap, speed_kph },
      ],
    };

    const finalSorted = sorted.map((r) => (r.id === updatedRider.id ? updatedRider : r));
    lastActionRef.current = { riderId: rider.id, timestamp: clickTime.getTime() }; // track last action for debouncing
    updateRider(updatedRider);
    updateAllRiders(finalSorted);
    setSearchTerm(""); // clear search after registering a lap

    // Cloud event log (local-first; no-op side effects for local-only races)
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

    // Trigger flash animation on the rider card
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashingRiderId(rider.id);
    flashTimerRef.current = setTimeout(() => setFlashingRiderId(null), 1200);

    // After the flash, deterministically drop this rider to the literal end of the
    // queue (or off it entirely if they just finished) — no lap-count/time guesswork,
    // so "tap it, it goes last" always means last, full stop.
    setTimeout(() => {
      setDisplayOrder((prev) => {
        const rest = prev.filter((id) => id !== rider.id);
        return isFinished ? rest : [...rest, rider.id];
      });
    }, 1000);

    // Add to detected numbers display (voice path adds this via the queue processor)
    const catColor = getCatColor(rider);
    const actionTimestamp = Date.now();
    if (source !== 'voice') {
      setDetectedNumbers((prev) => [
        ...prev,
        { bib: String(rider.bibNumber), categoryColor: catColor, timestamp: actionTimestamp },
      ]);
    }

    // Add to action log with unique ID (rider + lap + timestamp)
    setRiderActions((prev) => [
      { id: `${rider.id}-${lapsCounter}-${actionTimestamp}`, rider: updatedRider, timestamp: actionTimestamp, source, categoryColor: catColor },
      ...prev,
    ]);
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
          const cat = categories.find((c) => c.name === rider.category);
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

  const handleRevertLap = (rider: RiderProps) => {
    if (rider.lapsCounter <= 0) { setContextRider(null); return; }
    if (!canForRace(raceUuid, "UNDO_EVENT")) {
      toast.warn("No permission to undo laps");
      setContextRider(null);
      return;
    }
    const newDetails = (rider.lapsDetails ?? []).slice(0, -1);
    const prevArrive = newDetails.length > 0
      ? new Date(newDetails[newDetails.length - 1].endTime).toISOString()
      : null;
    const revertedRider: RiderProps = {
      ...rider,
      lapsCounter: rider.lapsCounter - 1,
      lapsDetails: newDetails,
      timeArrive: prevArrive,
      raceStatus: "running",
      elapsedLastLap: newDetails.length > 0 ? newDetails[newDetails.length - 1].lapTime : null,
    };
    updateRider(revertedRider);
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
    setContextRider(null);
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
      const catColor = getCatColor(rider);
      const statusTimestamp = Date.now();
      setRiderActions((prev) => [
        {
          id: `${rider.id}-status-${status}-${statusTimestamp}`,
          rider: updatedRider,
          timestamp: statusTimestamp,
          source: 'click',
          categoryColor: catColor,
          statusChange: status as 'DNF' | 'DSQ' | 'DNS'
        },
        ...prev,
      ]);
    }

    setContextRider(null);
  };

  const handleSaveComment = (rider: RiderProps, comment: string) => {
    updateRider({ ...rider, comment });
  };

  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const lastActionRef = useRef<{ riderId: number; timestamp: number } | null>(null);

  const toggleCatFilter = (catName: string) => {
    setFilterCats((prev) => {
      const next = new Set(prev);
      if (next.has(catName)) next.delete(catName);
      else next.add(catName);
      return next;
    });
  };

  const catOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    waveCategories.forEach((cat, idx) => map.set(cat.name, idx));
    return map;
  }, [waveCategories]);

  // All non-finished riders for this heat, ignoring search/category filter — this is the
  // stable pool the manual queue (displayOrder) tracks, so typing in the search box never
  // reshuffles anyone's position.
  const runningRiders = useMemo(
    () => filteredRiders.filter((r) => r.raceStatus !== "finished"),
    [filteredRiders]
  );

  const activeRiders = useMemo(() => {
    const catFiltered = filterCats.size > 0 ? runningRiders.filter((r) => filterCats.has(r.category)) : runningRiders;
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
          const catA = catOrderMap.get(a.category) ?? 999;
          const catB = catOrderMap.get(b.category) ?? 999;
          if (catA !== catB) return catA - catB;
          return a.bibNumber - b.bibNumber;
        })
        .map((r) => r.id);
      if (newcomers.length === 0 && kept.length === prev.length) return prev;
      return [...kept, ...newcomers];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningIdsKey]);

  // Build displayed riders: stable order from displayOrder, live data from activeRiders
  const displayedRiders = useMemo(() => {
    const riderMap = new Map(activeRiders.map((r) => [r.id, r]));
    const ordered: RiderProps[] = [];
    for (const id of displayOrder) {
      const r = riderMap.get(id);
      if (r) ordered.push(r);
      riderMap.delete(id);
    }
    // Any new riders not yet in displayOrder go at the end
    riderMap.forEach((r) => ordered.push(r));
    return ordered;
  }, [activeRiders, displayOrder]);

  // Per-category cascade bell: if linkedFinish AND the leader has finished,
  // all remaining running riders in that category should show the last-lap bell
  const cascadeBellCats = useMemo(() => {
    const set = new Set<string>();
    waveCategories.forEach((cat) => {
      if (!cat.linkedFinish) return;
      const catRunners = filteredRiders.filter((r) => r.category === cat.name);
      const anyFinished = catRunners.some(
        (r) => r.raceStatus === "finished" && !["DNF", "DSQ", "DNS"].includes(r.status)
      );
      if (anyFinished) set.add(cat.name);
    });
    return set;
  }, [waveCategories, filteredRiders]);

  const finishedRiders = useMemo(() => {
    const outOrder = (r: RiderProps) => {
      if (r.status === "DNF") return 1;
      if (r.status === "DSQ") return 2;
      if (r.status === "DNS") return 3;
      return 0;
    };
    return [...filteredRiders]
      .filter((r) => r.raceStatus !== "running" && (filterCats.size === 0 || filterCats.has(r.category)))
      .sort((a, b) => {
        const oa = outOrder(a), ob = outOrder(b);
        if (oa !== ob) return oa - ob;
        return (a.position_category ?? 999) - (b.position_category ?? 999);
      });
  }, [filteredRiders, filterCats]);

  const validBibs = useMemo(() => {
    const set = new Set<string>();
    filteredRiders.forEach((r) => {
      if (r.raceStatus !== "finished") {
        set.add(String(r.bibNumber));
      }
    });
    return set;
  }, [filteredRiders]);

  const { isListening, lastTranscript } = useVoiceRecognition({
    language: voiceSettings.language,
    validBibs,
    commands: [],
    onBibDetected: (bib) => {
      // Push into buffer queue; processor handles cooldown + dedup + retry
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

  // Cleanup timers on unmount
  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  }, []);

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
    const startRider = filteredRiders.find((r) => r.raceStatus === "running" && r.timeStartRace);
    const startDate = parseTimeStr(startRider?.timeStartRace);
    if (!startDate) return "00:00:00";
    return formatTimeWithLeadingZeroes(Math.max(0, now.getTime() - startDate.getTime()) / 1000);
  }, [filteredRiders, now]);

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
    <div className={styles.heat}>
      <HeaderHeats raceId={raceUuid} onSettingsClick={() => setShowVoiceSettings(true)} />

      {/* Rider detail modal (double-click) */}
      {contextRider && (
        <RiderLiveModal
          rider={contextRider}
          catColor={getCatColor(contextRider)}
          onClose={() => setContextRider(null)}
          onRevertLap={handleRevertLap}
          onStatusChange={handleStatusChange}
          onSaveComment={handleSaveComment}
        />
      )}

      {/* Voice settings modal */}
      {showVoiceSettings && (
        <VoiceSettingsModal onClose={() => setShowVoiceSettings(false)} />
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
                <span className={styles.waveModalName}>{cat.name}</span>
                {cat.laps && <span className={styles.waveModalLaps}>{cat.laps} laps</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.wrapper}>
        {/* Timer row with wave-info icon */}
        <div className={styles.timerRow}>
          <p className={styles.timerText}>{elapsedTime}</p>
          <button className={styles.waveInfoBtn} onClick={() => setShowWaveInfo(true)} title="Wave info">
            {waveCategories.slice(0, 4).map((cat) => (
              <span key={cat.id} className={styles.miniDot} style={{ background: cat.color ?? "#ccc" }} />
            ))}
          </button>
        </div>

        <div className={styles.searchWrapper}>
          <div className={styles.inputContainer}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={5}
              className={styles.searchInput}
              placeholder="#"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm ? (
              <button className={styles.clearSearch} onClick={() => setSearchTerm("")}>✕</button>
            ) : (
              <img src={Icons.search} alt="search" width={16} height={16} className={styles.inputIcon} />
            )}
          </div>
        </div>

        {/* Filter panel popup */}
        {showFilterPanel && (
          <div className={styles.filterPanelOverlay} onClick={() => setShowFilterPanel(false)}>
            <div className={styles.filterPanel} onClick={(e) => e.stopPropagation()}>
              <div className={styles.filterPanelHeader}>
                <span>Filter Categories</span>
                <button className={styles.contextClose} onClick={() => setShowFilterPanel(false)}>✕</button>
              </div>
              <label className={styles.filterPanelRow}>
                <input
                  type="checkbox"
                  checked={filterCats.size === 0}
                  onChange={() => setFilterCats(new Set())}
                />
                <span>All categories</span>
              </label>
              <div className={styles.filterDivider} />
              {waveCategories.map((cat) => (
                <label key={cat.id} className={styles.filterPanelRow}>
                  <input
                    type="checkbox"
                    checked={filterCats.has(cat.name)}
                    onChange={() => toggleCatFilter(cat.name)}
                  />
                  <span className={styles.catDot} style={{ background: cat.color ?? "#ccc" }} />
                  <span>{cat.name}</span>
                  {cat.laps && <span className={styles.filterLapTag}>{cat.laps}L</span>}
                </label>
              ))}
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
            </div>
            <button
              className={`${styles.filterIconBtn} ${filterCats.size > 0 ? styles.filterIconActive : ""}`}
              onClick={() => setShowFilterPanel(true)}
              title="Filter categories"
            >
              {filterCats.size > 0 ? `Filter (${filterCats.size})` : "Filter"}
            </button>
          </div>

          <div className={styles.ridersWrapper}>
            <div className={styles.riderGrid}>
              {displayedRiders.map((rider) => (
                <RacingRider
                  key={rider.id}
                  rider={rider}
                  color={getCatColor(rider)}
                  forceBell={cascadeBellCats.has(rider.category)}
                  isFlashing={flashingRiderId === rider.id}
                  onClick={() => handleRiderClick(rider)}
                  onDoubleClick={() => setContextRider(rider)}
                />
              ))}
            </div>

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

      {/* Voice debug panel — visible only when voice is active */}
      {voiceActive && (
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
        </div>
      </div>

      {/* Rider action log */}
      <RiderActionLog
        actions={riderActions}
        isOpen={showActionLog}
        onToggle={() => setShowActionLog(!showActionLog)}
        onCancel={(actionId, riderName) => {
          const action = riderActions.find((a) => a.id === actionId);
          if (!action) return;

          // Extract rider ID from action ID (format: ${rider.id}-${lapsCounter}-${timestamp})
          const riderIdStr = actionId.split('-')[0];
          const rider = riders.find((r) => r.id === Number(riderIdStr));
          if (!rider || rider.lapsCounter <= 0) return;

          // Revert the last lap
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

          // Remove from action log
          setRiderActions((prev) => prev.filter((a) => a.id !== actionId));
          toast.success(`Cancelled: ${riderName}`);
        }}
      />
    </div>
  );
};

export default Heat;
