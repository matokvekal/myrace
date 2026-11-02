import React, { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import useRaceStore from "@/stores/racesStore";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import Results from "./Results";
import RaceTopBar from "../../components/raceSidebar/RaceTopBar";
import { useLiveRaceRoom } from "@/services/live/liveRaceRoom";
import styles from "./resultsPage.module.css";

/**
 * Dedicated Results screen, reached from the race sidebar. It is the existing
 * Results component — same ranking and column picker — opened full-screen,
 * grouped Wave → Category; sort and category in one filter menu. A shared race
 * joins its live room so results follow the race without polling.
 */
const ResultsPage: React.FC = () => {
  const params = useParams();
  const waveParam = Number(useSearchParams()[0].get("wave"));
  const raceUuid = params.id as string;
  const race = useRaceStore((s) => s.races.find((r) => r.uuid === raceUuid));
  const getRaces = useRaceStore((s) => s.getRaces);
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

  return (
    <>
      <RaceTopBar />
      <div className={styles.page}>
        <Results raceUuid={raceUuid} defaultGroupBy="wave" defaultWave={waveParam > 0 ? waveParam : undefined} />
      </div>
    </>
  );
};

export default ResultsPage;
