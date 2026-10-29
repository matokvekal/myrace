import React, { useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import useRaceStore from "@/stores/racesStore";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import useUIStore from "@/stores/uiStore";
import RaceTopBar from "../../components/raceSidebar/RaceTopBar";
import LiveBoard from "../raceMode/LiveBoard";
import { getScheduleWaves, buildSchedule } from "../schedule/Schedule";
import { canViewScreen } from "@/services/live/liveBridge";
import styles from "./boardPage.module.css";

/**
 * Board as its own race screen (race sidebar, below Results). The same LiveBoard
 * the Race screen used to host, with a wave picker in place of the old wave bar.
 */
const BoardPage: React.FC = () => {
  const raceUuid = useParams().id as string;
  // Opened from a wave (?wave=N): show that wave only. From the sidebar: every wave.
  const [searchParams, setSearchParams] = useSearchParams();
  const waveParam = Number(searchParams.get("wave"));
  const oneWave = waveParam > 0;
  const race = useRaceStore((s) => s.races.find((r) => r.uuid === raceUuid));
  const getRaces = useRaceStore((s) => s.getRaces);
  const allCategories = useCategoryStore((s) => s.categories);
  const getCategories = useCategoryStore((s) => s.getCategories);
  const getRiders = useRiderStore((s) => s.getRiders);
  const selectedWave = useUIStore((s) => s.selectedWave);
  const setSelectedWave = useUIStore((s) => s.setSelectedWave);

  // Direct loads (reload / shared link) must hydrate the stores themselves.
  useEffect(() => {
    void (async () => {
      if (!race) await getRaces();
      await getCategories(raceUuid);
      await getRiders(raceUuid);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceUuid]);

  const categories = useMemo(() => allCategories.filter((c) => c.raceUuid === raceUuid), [allCategories, raceUuid]);
  const waves = useMemo(() => getScheduleWaves(categories), [categories]);

  useEffect(() => {
    if (oneWave && waveParam !== selectedWave) setSelectedWave(waveParam);
    else if (waves.length && !waves.some((w) => w.waveNum === selectedWave)) setSelectedWave(waves[0].waveNum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waves, oneWave, waveParam]);
  const boardCategories = useMemo(
    () => (oneWave ? [...(buildSchedule(categories).get(waveParam)?.values() ?? [])].flat() : categories),
    [oneWave, waveParam, categories]
  );

  return (
    <>
      <RaceTopBar>
        {waves.length > 0 && (
          <select
            className={styles.waveSelect}
            value={selectedWave}
            onChange={(e) => {
              const w = Number(e.target.value);
              setSelectedWave(w);
              if (oneWave) setSearchParams({ wave: String(w) }, { replace: true });
            }}
            aria-label="Wave"
            data-testid="board-wave"
          >
            {waves.map((w) => (
              <option key={w.waveNum} value={w.waveNum}>
                Wave {w.waveNum}{w.startTime ? ` · ${w.startTime}` : ""}
              </option>
            ))}
          </select>
        )}
      </RaceTopBar>
      <div className={styles.page}>
        {!canViewScreen(raceUuid, "board") ? (
          <p className={styles.note}>Your role in this race does not include this screen.</p>
        ) : waves.length === 0 ? (
          <p className={styles.note}>No waves configured</p>
        ) : (
          <LiveBoard raceUuid={raceUuid} waveNum={selectedWave} categories={boardCategories} />
        )}
      </div>
    </>
  );
};

export default BoardPage;
