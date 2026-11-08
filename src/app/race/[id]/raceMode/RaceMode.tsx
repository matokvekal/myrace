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
import { canViewScreen, isLiveRace, readLiveAccess } from "@/services/live/liveBridge";
import { canForRace } from "@/services/cloud/permissions";
import { useCheckInChanges, type CheckInChange } from "@/stores/checkInChangesStore";
import CheckInChanges from "./CheckInChanges";
import WaveBlockedNotice from "./WaveBlockedNotice";
import { runningWaveOtherThan } from "@/utils/activeWave";

const NO_CHANGES: CheckInChange[] = [];

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
  const [changesWave, setChangesWave] = useState<number | null>(null);
  const navigate = useNavigate();
  // Start while an earlier wave is still on course: explain it here, before the
  // Start screen opens (the rule itself stays in StartManager + the server).
  const [blockedStart, setBlockedStart] = useState<{ wave: number; active: number } | null>(null);
  const startBlockedBy = (w: number): number | null =>
    waveStatusMap.get(w) === "upcoming" ? runningWaveOtherThan(categories, w) : null;
  const openWave = (w: number) => {
    setSelectedWave(w);
    // The card tap follows the wave's lifecycle (persisted state only):
    // completed → never the start sheet (its card offers Results | Board);
    // Check-In incomplete → Check-In; otherwise (ready or racing) the start sheet,
    // which holds per-group start / finish. Live is the card's Live action.
    const state = waveStatusMap.get(w);
    const cats = [...(schedule.get(w)?.values() ?? [])].flat();
    if (state === "finished") {
      setSheet(null);
      return;
    }
    const waveRiders = raceRiders.filter((r) => cats.some((c) => riderInCategory(r, c)));
    const ciIncomplete =
      state === "upcoming" &&
      waveRiders.some((r) => !r.checked && !["DNS", "DNF", "DSQ"].includes(r.status));
    if (!ciIncomplete) {
      const active = startBlockedBy(w);
      if (active != null) {
        setBlockedStart({ wave: w, active });
        return;
      }
    }
    setSheetView(ciIncomplete ? "checkin" : "summary");
    setSheet((s) => s ?? (ciIncomplete ? "half" : startSheetSize(w)));
  };
  // A wave with several starts opens the start sheet tall, so every start shows
  // without dragging; a single start keeps the half sheet.
  const startSheetSize = (w: number): SheetSize => ((schedule.get(w)?.size ?? 0) > 1 ? "full" : "half");
  // Card actions: Check-In / Start open the sheet; Live / Finish go to the Live screen
  // (Finish opens its existing FINISH confirmation there).
  const onWaveAction = (w: number, action: WaveAction) => {
    setSelectedWave(w);
    if (action === "changes") {
      setChangesWave(w);
    } else if (action === "checkin") {
      setSheetView("checkin");
      setSheet("half"); // Check-In opens at 70%; drag up to 95%
    } else if (action === "start") {
      const active = startBlockedBy(w);
      if (active != null) {
        setBlockedStart({ wave: w, active });
        return;
      }
      setSheetView("summary");
      setSheet((s) => s ?? startSheetSize(w));
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
  const race = useRaceStore((s) => s.races.find((r) => r.uuid === raceUuid));
  const raceDate = race?.date;
  // The main commissaire's review of what changed on the start list
  const allChanges = useCheckInChanges((s) => (s.raceUuid === raceUuid ? s.changes : NO_CHANGES));
  const loadChanges = useCheckInChanges((s) => s.load);
  React.useEffect(() => {
    if (race) void loadChanges(race);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceUuid, !!race, loadChanges]);
  // Shared race (0.3.3): the log is the server's, so another judge's change shows up here too.
  // Re-read it (debounced) only when a not-yet-started rider's bib, name or status changed or a
  // rider was added: laps in a running wave don't trigger it, and there is no polling.
  const startListSig = useMemo(
    () =>
      isLiveRace(raceUuid)
        ? raceRiders
            .filter((r) => r.raceStatus !== "running" && r.raceStatus !== "finished")
            .map((r) => `${r.id}:${r.bibNumber}:${r.status}:${r.firstName}:${r.lastName}`)
            .join("|")
        : "",
    [raceRiders, raceUuid]
  );
  const firstSig = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!race || !startListSig) return;
    if (firstSig.current === null) {
      firstSig.current = startListSig; // the mount load above already has it
      return;
    }
    const t = setTimeout(() => void loadChanges(race), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startListSig]);
  const changeCounts = useMemo(() => {
    const counts = new Map<number, number>();
    // Shared race: every judge with Check-In sees the race's changes (read-only); local: as before.
    const mayView = isLiveRace(raceUuid) ? !!readLiveAccess(raceUuid)?.screens.checkin?.view : canForRace(raceUuid, "EDIT_RACE");
    if (!mayView) return counts;
    allChanges.forEach((c) => counts.set(c.wave, (counts.get(c.wave) ?? 0) + 1));
    return counts;
  }, [allChanges, raceUuid]);
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
          changeCounts={changeCounts}
        />
      </div>

      {blockedStart && (
        <WaveBlockedNotice
          activeWave={blockedStart.active}
          wave={blockedStart.wave}
          onBack={() => setBlockedStart(null)}
          onGoToActive={() => { const a = blockedStart.active; setBlockedStart(null); navigate(`/race/${raceUuid}/heat/${a}`); }}
        />
      )}
      {changesWave != null && (
        <CheckInChanges
          wave={changesWave}
          changes={allChanges.filter((c) => c.wave === changesWave)}
          onClose={() => setChangesWave(null)}
        />
      )}

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
          onView={(v) => { setSheetView(v); if (v === "summary") setSheet(startSheetSize(selectedWave)); }}
          renderStart={() =>
            canViewScreen(raceUuid, "start")
              ? <StartManager raceUuid={raceUuid} waveNum={selectedWave} categories={waveCategories} simple onFixCheckIn={() => setSheetView("checkin")} onBackToRace={() => setSheet(null)} />
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
