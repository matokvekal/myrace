import React, { lazy, Suspense, useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import useRaceStore from "@/stores/racesStore";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import RaceTopBar from "../../components/raceSidebar/RaceTopBar";
const PublicShareButton = lazy(() => import("../../../live/PublicShareButton"));
const serverConfigured = !!import.meta.env.VITE_SERVER_URL;
import LiveBoard from "../raceMode/LiveBoard";
import { getScheduleWaves } from "../schedule/Schedule";
import { canViewScreen } from "@/services/live/liveBridge";
import { useLiveRaceRoom } from "@/services/live/liveRaceRoom";
import styles from "./boardPage.module.css";

/**
 * Board as its own race screen (race sidebar, below Results): every wave and
 * category, no wave filter. Opened from a wave (?wave=N) it scrolls to that wave.
 * Live updates come from the race's room (shared races); Refresh is on the board.
 */
const BoardPage: React.FC = () => {
  const raceUuid = useParams().id as string;
  const waveParam = Number(useSearchParams()[0].get("wave"));
  const race = useRaceStore((s) => s.races.find((r) => r.uuid === raceUuid));
  const getRaces = useRaceStore((s) => s.getRaces);
  const allCategories = useCategoryStore((s) => s.categories);
  const getCategories = useCategoryStore((s) => s.getCategories);
  const getRiders = useRiderStore((s) => s.getRiders);
  useLiveRaceRoom(raceUuid);

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
  const focusWave = waveParam > 0 ? waveParam : (waves[0]?.waveNum ?? 1);

  return (
    <>
      <RaceTopBar>
        {serverConfigured && race && (
          <Suspense fallback={null}>
            <PublicShareButton raceUuid={raceUuid} raceName={race.name} screen="board" />
          </Suspense>
        )}
      </RaceTopBar>
      <div className={styles.page}>
        {!canViewScreen(raceUuid, "board") ? (
          <p className={styles.note}>Your role in this race does not include this screen.</p>
        ) : waves.length === 0 ? (
          <p className={styles.note}>No waves configured</p>
        ) : (
          <LiveBoard raceUuid={raceUuid} waveNum={focusWave} categories={categories} scrollOnOpen={waveParam > 0} />
        )}
      </div>
    </>
  );
};

export default BoardPage;
