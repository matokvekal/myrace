import React, { useEffect } from "react";
import { useParams } from "react-router-dom";
import useRaceStore from "@/stores/racesStore";
import RaceTopBar from "../../components/raceSidebar/RaceTopBar";
import TeamPanel from "../../../live/TeamPanel";
import styles from "../board/boardPage.module.css";

/**
 * Team as its own race screen (race sidebar, server builds only): share the
 * race, members and invitations. Was a race-page tab until Create lost it.
 */
const TeamPage: React.FC = () => {
  const raceUuid = useParams().id as string;
  const race = useRaceStore((s) => s.races.find((r) => r.uuid === raceUuid));
  const getRaces = useRaceStore((s) => s.getRaces);

  // Direct loads (reload / shared link) must hydrate the race for the top bar.
  useEffect(() => {
    if (!race) void getRaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceUuid]);

  return (
    <>
      <RaceTopBar />
      <div className={styles.page}>
        <TeamPanel raceUuid={raceUuid} />
      </div>
    </>
  );
};

export default TeamPage;
