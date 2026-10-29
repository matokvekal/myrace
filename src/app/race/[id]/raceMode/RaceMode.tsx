import React, { useState, useMemo } from "react";
import styles from "./raceMode.module.css";
import { CategoryProps } from "@/types/types";
import StartManager from "./StartManager";
import CheckIn from "./CheckIn";
import BibWarning from "../../components/bibWarning/BibWarning";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES, riderInCategory, normalizeTime } from "../schedule/Schedule";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";
import { withoutIgnoredRiders } from "@/utils/ignoredWaves";
import useUIStore from "@/stores/uiStore";
import useRaceStore from "@/stores/racesStore";
import WaveTimeline from "./WaveTimeline";
import RaceSheet, { type SheetSize, type SheetView } from "./RaceSheet";
import type { WaveAction } from "./WaveTimeline";
import { useNavigate } from "react-router-dom";
import { canViewScreen } from "@/services/live/liveBridge";

interface Props {
  raceUuid: string;
  categories: CategoryProps[];
}

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
  // Bottom sheet: closed on entry (full timeline); a wave tap opens it at half height.
  const [sheet, setSheet] = useState<SheetSize | null>(null);
  const [sheetView, setSheetView] = useState<SheetView>("summary");
  const navigate = useNavigate();
  const openWave = (w: number) => {
    setSelectedWave(w);
    setSheetView("summary");
    setSheet((s) => s ?? "half");
  };
  // Card actions: Check-In / Start open the sheet; Live / Finish go to the Live screen
  // (Finish opens its existing FINISH confirmation there).
  const onWaveAction = (w: number, action: WaveAction) => {
    setSelectedWave(w);
    if (action === "checkin") {
      setSheetView("checkin");
      setSheet("half"); // Check-In opens at 50%; drag up to 70%
    } else if (action === "start") {
      setSheetView("summary");
      setSheet((s) => s ?? "half");
    } else if (action === "results" || action === "board") {
      // The existing screens, opened on this wave
      navigate(`/race/${raceUuid}/${action}?wave=${w}`);
    } else {
      navigate(`/race/${raceUuid}/heat/${w}${action === "finish" ? "?finish=1" : ""}`);
    }
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
  const startLabel = (() => {
    const k = [...(schedule.get(selectedWave)?.keys() ?? [])].find((x) => x !== "TBD");
    return k ? normalizeTime(k) ?? k : "TBD";
  })();
  const deny = <p style={{ padding: 16 }}>Your role in this race does not include this screen.</p>;

  return (
    <div className={styles.container}>
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
        }}
      />

      {/* Race day timeline: the main screen. A wave tap opens its bottom sheet. */}
      <div className={`${styles.rdc} ${sheet ? styles.rdcWithSheet : ""}`}>
        <WaveTimeline
          schedule={schedule}
          states={waveStatusMap}
          riders={raceRiders}
          selected={sheet ? selectedWave : -1}
          onSelect={openWave}
          date={raceDate}
          current={selectedWave}
          onAction={onWaveAction}
        />
      </div>

      {sheet && waveNums.includes(selectedWave) && (
        <RaceSheet
          wave={selectedWave}
          state={waveStatusMap.get(selectedWave) ?? "upcoming"}
          startLabel={startLabel}
          categories={waveCategories}
          riders={raceRiders}
          size={sheet}
          onSize={setSheet}
          onClose={() => setSheet(null)}
          view={sheetView}
          onView={setSheetView}
          renderStart={() =>
            canViewScreen(raceUuid, "start")
              ? <StartManager raceUuid={raceUuid} waveNum={selectedWave} categories={waveCategories} />
              : deny
          }
          renderCheckIn={() =>
            canViewScreen(raceUuid, "checkin")
              ? <CheckIn raceUuid={raceUuid} waveNum={selectedWave} categories={waveCategories} slots={schedule.get(selectedWave)} />
              : deny
          }
        />
      )}
    </div>
  );
};

export default RaceMode;
