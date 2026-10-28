import React, { useEffect } from "react";
import { useParams } from "react-router-dom";
import useRaceStore from "@/stores/racesStore";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import Results from "./Results";
import RaceTopBar from "../../components/raceSidebar/RaceTopBar";
import styles from "./resultsPage.module.css";

/**
 * Dedicated Results screen, reached from the race sidebar. It is the existing
 * Results component — same ranking and column picker — opened full-screen,
 * grouped Wave → Category, with a chip bar to jump between categories.
 */
const ResultsPage: React.FC = () => {
  const params = useParams();
  const raceUuid = params.id as string;
  const race = useRaceStore((s) => s.races.find((r) => r.uuid === raceUuid));
  const getRaces = useRaceStore((s) => s.getRaces);
  const getCategories = useCategoryStore((s) => s.getCategories);
  const getRiders = useRiderStore((s) => s.getRiders);

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
        <Results raceUuid={raceUuid} defaultGroupBy="wave" quickNav />
      </div>
    </>
  );
};

export default ResultsPage;
