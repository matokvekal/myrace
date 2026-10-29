import React, { useState, useMemo } from "react";
import styles from "./raceMode.module.css";
import { CategoryProps } from "@/types/types";
import StartManager from "./StartManager";
import CheckIn from "./CheckIn";
import LiveBoard from "./LiveBoard";
import WaveStatus from "./WaveStatus";
import BibWarning from "../../components/bibWarning/BibWarning";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES, riderInCategory, normalizeTime } from "../schedule/Schedule";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import { withoutIgnoredRiders } from "@/utils/ignoredWaves";
import useUIStore from "@/stores/uiStore";
import useRaceStore from "@/stores/racesStore";
import WaveTimeline, { WaveSummary } from "./WaveTimeline";
import { canViewScreen } from "@/services/live/liveBridge";

interface Props {
  raceUuid: string;
  categories: CategoryProps[];
}

type SubTab = "start" | "checkin" | "board" | "status";

const RaceMode: React.FC<Props> = ({ raceUuid, categories }) => {
  // Group categories by time gap (same logic as Schedule view)
  const schedule = useMemo(
    () => buildSchedule(categories, DEFAULT_WAVE_GAP_MINUTES),
    [categories]
  );
  const waveNums = useMemo(() => [...schedule.keys()], [schedule]);
  // Shared across Race and Live phases so the top switcher opens the right heat
  const selectedWave = useUIStore((s) => s.selectedWave);
  const setSelectedWave = useUIStore((s) => s.setSelectedWave);
  const [subTab, setSubTab] = useState<SubTab>("start");
  // Wave workspace: closed on entry (full timeline); opens on a wave tap.
  const [panelOpen, setPanelOpen] = useState(false);
  const openWave = (w: number) => {
    setSelectedWave(w);
    setPanelOpen(true);
  };

  // Ensure the selected wave is valid for this race's schedule
  React.useEffect(() => {
    if (waveNums.length && !waveNums.includes(selectedWave)) {
      setSelectedWave(waveNums[0]);
    }
  }, [waveNums, selectedWave, setSelectedWave]);

  const waveStatusMap = useMemo(() => {
    const map = new Map<number, "upcoming" | "running" | "finished">();
    waveNums.forEach((w) => {
      const cats = [...(schedule.get(w)?.values() ?? [])].flat();
      if (cats.length === 0) { map.set(w, "upcoming"); return; }
      if (cats.every((c) => c.status === "finished")) map.set(w, "finished");
      else if (cats.some((c) => c.status === "running")) map.set(w, "running");
      else map.set(w, "upcoming");
    });
    return map;
  }, [schedule, waveNums]);

  // All categories in the selected time-based wave (all start slots combined)
  const waveCategories = useMemo(() => {
    const startMap = schedule.get(selectedWave);
    if (!startMap) return [];
    return [...startMap.values()].flat();
  }, [schedule, selectedWave]);

  // Nudge the commissaire toward Check-In when nobody in this wave has checked in yet
  // Riders of ignored waves take no part in race operations (data kept).
  const storeRiders = useRiderStore((state) => state.riders);
  const storeCategories = useCategoryStore((state) => state.categories);
  const riders = useMemo(() => withoutIgnoredRiders(storeRiders, storeCategories), [storeRiders, storeCategories]);
  const raceRiders = useMemo(() => riders.filter((r) => r.raceUuid === raceUuid), [riders, raceUuid]);
  const raceDate = useRaceStore((s) => s.races.find((r) => r.uuid === raceUuid)?.date);
  const needsCheckIn = useMemo(() => {
    if (waveStatusMap.get(selectedWave) !== "upcoming") return false;
    const waveRiders = riders.filter(
      (r) => r.raceUuid === raceUuid && waveCategories.some((c) => riderInCategory(r, c))
    );
    if (waveRiders.length === 0) return false;
    return waveRiders.every(
      (r) => !r.checked && !["DNS", "DNF", "DSQ"].includes(r.status)
    );
  }, [riders, raceUuid, waveCategories, waveStatusMap, selectedWave]);

  return (
    <div className={styles.container}>
      {/* Race day control center: full timeline; a wave tap slides in its workspace */}
      <div className={`${styles.rdc} ${panelOpen ? styles.rdcOpen : ""}`}>
        <div className={styles.rdcRail}>
          <WaveTimeline
            schedule={schedule}
            states={waveStatusMap}
            riders={raceRiders}
            selected={panelOpen ? selectedWave : -1}
            onSelect={openWave}
            date={raceDate}
            compact={panelOpen}
            current={selectedWave}
          />
        </div>
        {panelOpen && (
        <div className={styles.rdcPanel} data-testid="wave-panel">
          <div className={styles.panelHead}>
          {waveNums.includes(selectedWave) && (
            <WaveSummary
              wave={selectedWave}
              state={waveStatusMap.get(selectedWave) ?? "upcoming"}
              startLabel={(() => {
                const k = [...(schedule.get(selectedWave)?.keys() ?? [])].find((x) => x !== "TBD");
                return k ? normalizeTime(k) ?? k : "TBD";
              })()}
              cats={waveCategories}
              riders={raceRiders}
              compact
              onClose={() => setPanelOpen(false)}
            />
          )}
      {/* Sub-tab bar */}
        <div className={styles.subTabs}>
          {canViewScreen(raceUuid, "start") && <button className={`${styles.subTab} ${styles.tabGrid} ${subTab === "start" ? styles.subTabActive : ""}`} onClick={() => setSubTab("start")}>
            Grid
          </button>}
          {canViewScreen(raceUuid, "checkin") && <button
            className={[
              styles.subTab,
              styles.tabCheckin,
              subTab === "checkin" ? styles.subTabActive : "",
              needsCheckIn && subTab !== "checkin" ? styles.subTabGlow : "",
            ].join(" ")}
            onClick={() => setSubTab("checkin")}
          >
            Check-In
          </button>}
          {canViewScreen(raceUuid, "board") && <button className={`${styles.subTab} ${styles.tabBoard} ${subTab === "board" ? styles.subTabActive : ""}`} onClick={() => setSubTab("board")}>
            Board
          </button>}
          {/* Everyone in the wave with their current status (BUGS.md #24) */}
          {canViewScreen(raceUuid, "status") && <button
            className={`${styles.subTab} ${styles.tabStatus} ${subTab === "status" ? styles.subTabActive : ""}`}
            onClick={() => setSubTab("status")}
          >
            All Riders
          </button>}
        </div>
          </div>
      {/* Bib problems anywhere in the race, before anyone reaches Start */}
      <BibWarning
        raceUuid={raceUuid}
        categories={categories}
        riders={riders}
        onFix={(cat) => {
          const wave = waveNums.find((w) =>
            [...(schedule.get(w)?.values() ?? [])].flat().some((c) => c.id === cat.id)
          );
          if (wave != null) openWave(wave);
          setSubTab("checkin");
        }}
      />

      <div className={styles.content}>
        {!canViewScreen(raceUuid, subTab) && <p style={{ padding: 16 }}>Your role in this race does not include this screen.</p>}
        {subTab === "start"   && canViewScreen(raceUuid, "start") && <StartManager raceUuid={raceUuid} waveNum={selectedWave} categories={waveCategories} />}
        {subTab === "checkin" && canViewScreen(raceUuid, "checkin") && <CheckIn raceUuid={raceUuid} waveNum={selectedWave} categories={waveCategories} slots={schedule.get(selectedWave)} />}
        {subTab === "board"   && canViewScreen(raceUuid, "board") && <LiveBoard raceUuid={raceUuid} waveNum={selectedWave} categories={categories} />}
        {subTab === "status"  && canViewScreen(raceUuid, "status") && <WaveStatus raceUuid={raceUuid} waveNum={selectedWave} categories={waveCategories} />}
      </div>
        </div>
        )}
      </div>
    </div>
  );
};

export default RaceMode;
