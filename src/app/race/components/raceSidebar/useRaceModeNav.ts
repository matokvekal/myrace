/**
 * Which race mode is on screen, and how to get to each one. Shared by the race
 * top bar (mode indicator) and the race sidebar (mode list), so both always
 * agree. Navigation only — no destructive actions.
 */
import { useLocation, useNavigate, useParams } from "react-router-dom";
import useUIStore from "@/stores/uiStore";
import useCategoryStore from "@/stores/categoryStore";
import { getDefaultLiveWave } from "../../[id]/schedule/Schedule";
import { useRaceFinalized } from "@/utils/raceLock";

export type RaceMode = "setup" | "race" | "live" | "results" | "board";

export function useRaceModeNav() {
  const navigate = useNavigate();
  const params = useParams();
  const raceUuid = params?.id as string;
  // On the live lap screen the route carries :heatId — that means we're in Live.
  const onLiveRoute = params?.heatId != null;
  const path = useLocation().pathname.replace(/\/+$/, "");
  const onResultsRoute = path.endsWith("/results");
  const onBoardRoute = path.endsWith("/board");

  const isRaceMode = useUIStore((s) => s.isRaceMode);
  const setRaceMode = useUIStore((s) => s.setRaceMode);
  const selectedWave = useUIStore((s) => s.selectedWave);
  const categories = useCategoryStore((s) => s.categories);
  // A finished race has no Race or Live mode left (see utils/raceLock.ts).
  const finalized = useRaceFinalized(raceUuid);

  const mode: RaceMode = onResultsRoute ? "results" : onBoardRoute ? "board" : onLiveRoute ? "live" : isRaceMode ? "race" : "setup";

  const goSetup = () => {
    if (onLiveRoute || onResultsRoute || onBoardRoute) navigate(`/race/${raceUuid}`);
    setRaceMode(false);
  };
  const goRace = () => {
    if (onLiveRoute || onResultsRoute || onBoardRoute) navigate(`/race/${raceUuid}`);
    setRaceMode(true);
  };
  // Opens whichever wave is actually live right now, never the Race screen's
  // `selectedWave` (that tracks whatever wave the commissaire was last
  // administering there, which can be stale). Once nothing is running —
  // race not started, or every wave already finished — falls back to the
  // first wave. Already on Live: leave it alone, so a manual wave-dropdown
  // pick on the heat page isn't clobbered.
  const goLive = () => {
    if (onLiveRoute) return;
    const raceCats = categories.filter((c) => c.raceUuid === raceUuid && !c.ignored);
    const wave = getDefaultLiveWave(raceCats) ?? selectedWave;
    navigate(`/race/${raceUuid}/heat/${wave}`);
  };
  const goResults = () => {
    if (!onResultsRoute) navigate(`/race/${raceUuid}/results`);
  };
  const goBoard = () => {
    if (!onBoardRoute) navigate(`/race/${raceUuid}/board`);
  };
  const goAllRaces = () => navigate("/main");

  const go: Record<RaceMode, () => void> = {
    setup: goSetup,
    race: goRace,
    live: goLive,
    results: goResults,
    board: goBoard,
  };

  return { raceUuid, mode, finalized, go, goAllRaces };
}
