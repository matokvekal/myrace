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
import { VoiceRadarIcon } from "@/components/voice/VoiceRadarIcon";
import { DetectedNumbers } from "@/components/voice/DetectedNumbers";
import { RiderActionLog } from "@/components/voice/RiderActionLog";

function parseTimeStr(t: string | null | undefined): Date | null {
  if (!t) return null;
  if (t.includes("T")) return new Date(t);
  const today = new Date();
  const [h, m, s = 0] = t.split(":").map(Number);
  today.setHours(h, m, s, 0);
  return today;
}

function getCatAvgLapMs(catRiders: RiderProps[]): number {
  const times: number[] = [];
  for (const r of catRiders) {
    for (const d of r.lapsDetails ?? []) {
      const ms = new Date(d.endTime).getTime() - new Date(d.startTime).getTime();
      if (ms > 0) times.push(ms);
    }
  }
  return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 10 * 60 * 1000;
}

function getExpectedArrival(rider: RiderProps, catAvgMs: number): number {
  const laps = rider.lapsDetails ?? [];

  // Use this rider's own avg lap if they have history, else category avg
  let avg = catAvgMs;
  if (laps.length > 0) {
    const times = laps
      .map((d) => new Date(d.endTime).getTime() - new Date(d.startTime).getTime())
      .filter((t) => t > 0);
    if (times.length > 0) avg = times.reduce((a, b) => a + b, 0) / times.length;
  }

  if (!rider.timeArrive) {
    // Never recorded a lap yet — treat as if they started right now,
    // so they're expected to arrive in ~1 avg lap from race start
    const raceStart = rider.timeStartRace
      ? new Date(
          rider.timeStartRace.includes("T")
            ? rider.timeStartRace
            : (() => { const d = new Date(); const [h,m,s=0] = rider.timeStartRace!.split(":").map(Number); d.setHours(h,m,s,0); return d; })()
        ).getTime()
      : Date.now();
    return raceStart + avg;
  }

  return new Date(rider.timeArrive).getTime() + avg;
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

  const [searchTerm, setSearchTerm] = useState("");
  const [filterCats, setFilterCats] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(new Date());
  const [contextRider, setContextRider] = useState<RiderProps | null>(null);
  const [showWaveInfo, setShowWaveInfo] = useState(false);
  const [displayOrder, setDisplayOrder] = useState<number[]>([]);
  const [voiceActive, setVoiceActive] = useState(false);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [voiceAudioLevel, setVoiceAudioLevel] = useState(0);
  const [voiceIsListening, setVoiceIsListening] = useState(false);
  const [detectedNumbers, setDetectedNumbers] = useState<Array<{ bib: string; categoryColor?: string; timestamp: number }>>([]);
  const [riderActions, setRiderActions] = useState<Array<{ id: string; rider: RiderProps; timestamp: number; source: 'click' | 'voice'; categoryColor: string }>>([]);
  const [showActionLog, setShowActionLog] = useState(false);
  const lastClickRef = useRef<number>(0);
  const sortTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    () => riders.filter((r) => r.raceUuid === raceUuid && heatCategories.includes(r.category)),
    [riders, raceUuid, heatCategories]
  );

  const getCatColor = (rider: RiderProps): string => {
    const cat = categories.find((c) => c.name === rider.category);
    return cat?.color ?? rider.color ?? "#ccc";
  };

  const catAvgLapMap = useMemo(() => {
    const map = new Map<string, number>();
    [...new Set(filteredRiders.map((r) => r.category))].forEach((name) => {
      map.set(name, getCatAvgLapMs(filteredRiders.filter((r) => r.category === name)));
    });
    return map;
  }, [filteredRiders]);

  const handleRiderClick = (rider: RiderProps, source: 'click' | 'voice' = 'click') => {
    if ((rider.totalLaps > 0 && rider.lapsCounter >= rider.totalLaps) || rider.raceStatus === "finished") return;

    const clickTime = new Date();

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
      raceStatus: isFinished ? "finished" : rider.raceStatus,
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
    lastClickRef.current = Date.now(); // marks this as a lap-click for delayed sort
    updateRider(updatedRider);
    updateAllRiders(finalSorted);
    setSearchTerm(""); // clear search after registering a lap

    // Add to detected numbers display
    const catColor = getCatColor(rider);
    setDetectedNumbers((prev) => [
      ...prev,
      { bib: String(rider.bibNumber), categoryColor: catColor, timestamp: Date.now() },
    ]);

    // Add to action log
    setRiderActions((prev) => [
      { id: String(rider.id), rider: updatedRider, timestamp: Date.now(), source, categoryColor: catColor },
      ...prev,
    ]);
  };

  const handleRevertLap = (rider: RiderProps) => {
    if (rider.lapsCounter <= 0) { setContextRider(null); return; }
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
    setContextRider(null);
  };

  const handleStatusChange = (rider: RiderProps, status: RiderProps["status"]) => {
    const isOut = ["DNF", "DSQ", "DNS"].includes(status);
    updateRider({
      ...rider,
      status,
      raceStatus: isOut ? "finished" : "running",
    });
    setContextRider(null);
  };

  const handleSaveComment = (rider: RiderProps, comment: string) => {
    updateRider({ ...rider, comment });
  };

  const [showFilterPanel, setShowFilterPanel] = useState(false);

  const toggleCatFilter = (catName: string) => {
    setFilterCats((prev) => {
      const next = new Set(prev);
      if (next.has(catName)) next.delete(catName);
      else next.add(catName);
      return next;
    });
  };

  const activeRiders = useMemo(() => {
    const running = filteredRiders.filter((r) => r.raceStatus === "running");
    const catFiltered = filterCats.size > 0 ? running.filter((r) => filterCats.has(r.category)) : running;
    const q = searchTerm.toLowerCase();
    const searched = q
      ? catFiltered.filter(
          (r) =>
            r.firstName.toLowerCase().includes(q) ||
            r.lastName.toLowerCase().includes(q) ||
            String(r.bibNumber).includes(q)
        )
      : catFiltered;
    return [...searched].sort((a, b) => {
      const expA = getExpectedArrival(a, catAvgLapMap.get(a.category) ?? 600000);
      const expB = getExpectedArrival(b, catAvgLapMap.get(b.category) ?? 600000);
      return expA - expB;
    });
  }, [filteredRiders, searchTerm, filterCats, catAvgLapMap]);

  // Delayed display order: re-sort only 5s after a lap click, immediately for search/filter changes
  const activeRiderIdsKey = activeRiders.map((r) => r.id).join(",");
  useEffect(() => {
    const ids = activeRiders.map((r) => r.id);
    const msSinceClick = Date.now() - lastClickRef.current;
    if (msSinceClick < 500) {
      // Triggered by a lap click — delay re-order by 5s
      if (sortTimerRef.current) clearTimeout(sortTimerRef.current);
      sortTimerRef.current = setTimeout(() => setDisplayOrder(ids), 5000);
    } else {
      // Search/filter/initial change — immediate
      if (sortTimerRef.current) clearTimeout(sortTimerRef.current);
      setDisplayOrder(ids);
    }
    return () => { if (sortTimerRef.current) clearTimeout(sortTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRiderIdsKey]);

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
      if (r.raceStatus === "running") {
        set.add(String(r.bibNumber));
      }
    });
    return set;
  }, [filteredRiders]);

  const { isListening } = useVoiceRecognition({
    language: voiceSettings.language,
    validBibs,
    commands: [],
    onBibDetected: (bib) => {
      const rider = filteredRiders.find((r) => String(r.bibNumber) === bib);
      if (!rider) return;

      // Add to detected numbers display
      const catColor = getCatColor(rider);
      setDetectedNumbers((prev) => [
        ...prev,
        { bib, categoryColor: catColor, timestamp: Date.now() },
      ]);

      if (voiceSettings.autoConfirm) {
        handleRiderClick(rider, 'voice');
      } else {
        setSearchTerm(bib);
      }
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
              className={styles.searchInput}
              placeholder="Search"
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

      {/* Floating mic button and voice indicator */}
      <div className={styles.voiceContainer}>
        {voiceActive && <VoiceIndicator />}

        <div className={styles.controlRow}>
          <div className={styles.numbersContainer}>
            {detectedNumbers.length > 0 && <DetectedNumbers numbers={detectedNumbers} />}
          </div>

          <button
            className={styles.micButtonRadar}
            onClick={() => setVoiceActive(!voiceActive)}
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

          const rider = riders.find((r) => r.id === Number(actionId));
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
