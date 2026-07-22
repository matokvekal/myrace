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
import { formatTimeWithLeadingZeroes, parseClockTime } from "../../../../utils/timeUtils";
import { useLapRecording } from "./useLapRecording";
import calculatePositions from "../../../../utils/calculatePosition";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES, riderInCategory, withCategoryLaps } from "../../schedule/Schedule";
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

// Category identity is name + subCategory: the same name can exist in several
// waves with different subcategories (e.g. Master Men 19-29 vs 30-49).
const catKey = (name: string, sub?: string | null) => `${name}|${sub ?? ""}`;
const riderCatKey = (r: { category: string; subCategory?: string | null }) =>
  catKey(r.category, r.subCategory);

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
  const [showActionLog, setShowActionLog] = useState(false);
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

  // A rider "still on the track": their category's race has ended but they
  // haven't finished — the organizer must not lose sight of them.
  const isOnTrackAfterEnd = (rider: RiderProps): boolean =>
    categories.find((c) => riderInCategory(rider, c))?.status === "finished";


  // Lap recording + rollback live in a dedicated hook (BUGS.md #29). Same rules
  // and side effects as before — this component just drives it.
  const {
    riderActions,
    setRiderActions,
    flashingRiderId,
    recordLap,
    revertLap,
    cancelAction,
    logStatusChange,
    clearTimers,
  } = useLapRecording({
    raceUuid,
    // Persist the action log per wave so a mid-wave reload restores every
    // arrival (BUGS.md #2). Keyed by race + heat so waves never share a log.
    persistKey: heatId != null ? `${raceUuid}:heat:${heatId}` : null,
    riders,
    updateRider,
    updateAllRiders,
    circuitKm,
    isOnTrackAfterEnd,
    getCatColor,
    displayOrder,
    setDisplayOrder,
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

  const handleRiderClick = (rider: RiderProps, source: 'click' | 'voice' = 'click') => {
    recordLap(rider, source);
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
      logStatusChange(updatedRider, status as 'DNF' | 'DSQ' | 'DNS');
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

  // Per-category cascade bell: if linkedFinish AND the leader has finished,
  // all remaining running riders in that category should show the last-lap bell
  const cascadeBellCats = useMemo(() => {
    const set = new Set<string>();
    waveCategories.forEach((cat) => {
      if (!cat.linkedFinish) return;
      const catRunners = filteredRiders.filter((r) => riderInCategory(r, cat));
      const anyFinished = catRunners.some(
        (r) => r.raceStatus === "finished" && !["DNF", "DSQ", "DNS"].includes(r.status)
      );
      if (anyFinished) set.add(catKey(cat.name, cat.subCategory));
    });
    return set;
  }, [waveCategories, filteredRiders]);

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
                onClick={() => { setClearedWave(true); setConfirmClear(false); }}
              >
                Clear board
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.wrapper}>
        {/* Timer row with wave-info button: which wave is live + its started categories */}
        <div className={styles.timerRow}>
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

        {/* Clear the board once the wave is fully stopped (BUGS.md #14) —
            resets the clock to 0 and removes every card. Results are untouched. */}
        {waveStopped && !clearedWave && (
          <div className={styles.clearRow}>
            <button className={styles.clearBtn} onClick={() => setConfirmClear(true)}>
              Clear board
            </button>
          </div>
        )}

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
                    {notStarted && <span className={styles.filterStatusTag}>not started</span>}
                    {finished && <span className={styles.filterStatusTagDone}>finished</span>}
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
                const onTrack = runningRiders.filter(isOnTrackAfterEnd).length;
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
                  forceBell={cascadeBellCats.has(riderCatKey(rider))}
                  isFlashing={flashingRiderId === rider.id}
                  raceEnded={isOnTrackAfterEnd(rider)}
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
          // The hook owns the undo: exact snapshot restore, queue slot restore,
          // and cancelling any pending drop-to-end (BUGS.md #10, #29).
          if (!cancelAction(actionId)) return;
          toast.success(`Cancelled: ${riderName}`);
        }}
      />
    </div>
  );
};

export default Heat;
