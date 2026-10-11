import React, { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Trophy } from "lucide-react";
import useRaceStore from "@/stores/racesStore";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import Results from "./Results";
import styles from "./resultsPage.module.css";

/**
 * Dedicated Results screen, reached from the header's Results button (Create,
 * Race and Live). It is the existing Results component — same ranking and column
 * picker — opened full-screen, grouped Wave → Category, with a chip bar to jump
 * between categories. Back returns to wherever the operator came from
 * (history -1), so the Live / Race screen and its context are left as they were.
 */
const ResultsPage: React.FC = () => {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();
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

  const back = () => {
    // "default" is the key of the first entry in this session: nothing to go back to.
    if (location.key !== "default") navigate(-1);
    else navigate(`/race/${raceUuid}`);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={back} data-testid="results-back" aria-label="Back">
          <ArrowLeft size={18} /> Back
        </button>
        <div className={styles.title}>
          <Trophy size={16} /> Results
          {race?.name && <span className={styles.raceName}>{race.name}</span>}
        </div>
      </header>
      <Results raceUuid={raceUuid} defaultGroupBy="wave" quickNav />
    </div>
  );
};

export default ResultsPage;
