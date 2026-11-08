import React, { useState, useEffect, useMemo, Suspense, lazy } from "react";
import { Lock } from "lucide-react";
import styles from "./race.module.css";
import HeaderRace from "../components/headerRace/HeaderRace";
import Loader from "@/components/Loader";
import { resolveRaceImage } from "@/utils/resolveRaceImage";
import RaceInfo from "../components/raceInfo/RaceInfo";
import useCategoryStore from "@/stores/categoryStore";
import useRaceStore from "@/stores/racesStore";
import useRiderStore from "@/stores/ridersStore";
import useUIStore from "@/stores/uiStore";
import Riders from "./riders/Riders";
// The Map tab pulls in Leaflet (~150 kB); load it only when opened (BUGS.md #1).
const Map = lazy(() => import("./map/Map"));
import Schedule from "./schedule/Schedule";
import Categories from "./categories/Categories";
import Info from "./info/Info";
import RaceMode from "./raceMode/RaceMode";
import EditRiders from "./editRiders/EditRiders";
import { useParams, useNavigate } from "react-router-dom";
import { useDataStore } from "@/stores/appStore";
import { DEMO_RACE_UUID, DEMO_LIVE_ONBOARD_KEY } from "@/utils/demoSeed";
// import RaceCloudPanel from "@/components/cloud/RaceCloudPanel"; // cloud tab hidden for now
import useCloudRaceSync from "@/hooks/useCloudRaceSync";
import { canForRace } from "@/services/cloud/permissions";
import { isRaceFinalized } from "@/utils/raceLock";
import { canViewScreen, isJudgeOnly, isLiveRace, LIVE_ACCESS_EVENT } from "@/services/live/liveBridge";
import { useLiveRaceRoom } from "@/services/live/liveRaceRoom";
// Multi-user (only with a configured server): sharing, members, sync state.
const SyncBadge = lazy(() => import("../../live/SyncBadge"));
const ShareRace = lazy(() => import("../../live/ShareRace"));
const InviteJudges = lazy(() => import("../../live/InviteJudges"));
const LocalOnlyBadge = lazy(() => import("../../live/LocalOnlyBadge"));
const serverConfigured = !!import.meta.env.VITE_SERVER_URL;

const TABS = [
  "schedule",
  "categories",
  "riders",
  "map",
  // "cloud", // hidden for now
  "info"
] as const;
type Tab = (typeof TABS)[number];

/**
 * Tabs a FINALIZED race still shows. Schedule and Categories are setup tools
 * for a race that hasn't happened yet — on a closed race they'd offer edits
 * that silently do nothing, so they're dropped. Results lives in the race sidebar.
 */
const FINALIZED_TABS: Tab[] = ["riders", "map", "info"];

const Race: React.FC = () => {
  const params = useParams();
  const raceUuid = params?.id as string;
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [ridersEdit, setRidersEdit] = useState(false);

  const getRaces = useRaceStore((s) => s.getRaces);
  const races = useRaceStore((s) => s.races);
  const deleteRace = useRaceStore((s) => s.deleteRace);
  const deleteRidersByRace = useRiderStore((s) => s.deleteRidersByRace);
  const getCategories = useCategoryStore((s) => s.getCategories);
  const createCategoriesFromRiders = useCategoryStore(
    (s) => s.createCategoriesFromRiders
  );
  const categories = useCategoryStore((s) => s.categories);
  const filteredCategories = categories.filter((c) => c.raceUuid === raceUuid);

  const isRaceMode = useUIStore((s) => s.raceModeRace === raceUuid);
  const setRaceModeRace = useUIStore((s) => s.setRaceModeRace);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const { activeTab, setActiveTab } = useDataStore();
  // Shared race: re-render when this member's access changes (screens appear/disappear at once).
  const [, setAccessTick] = useState(0);
  useEffect(() => {
    const onAccess = () => setAccessTick((n) => n + 1);
    window.addEventListener(LIVE_ACCESS_EVENT, onAccess);
    return () => window.removeEventListener(LIVE_ACCESS_EVENT, onAccess);
  }, []);
  const live = isLiveRace(raceUuid);
  // 0.3.3: every view of a shared race (RACE / Check-In included, not only LIVE) is in the race's
  // live room, so other judges' changes (check-ins, statuses, bibs) arrive at once over the socket.
  // SyncBadge did this only outside Race mode — a judge who lands on RACE never joined.
  useLiveRaceRoom(raceUuid);

  // no-op unless this race is cloud-linked and the user is logged in
  useCloudRaceSync(raceUuid);

  // Demo onboarding: the demo seeds mid-race (Wave 1 live on course), so the
  // FIRST open of the demo race in a session jumps straight to the Live page.
  // One-shot via sessionStorage — the user can still navigate back afterwards.
  useEffect(() => {
    if (raceUuid !== DEMO_RACE_UUID) return;
    try {
      if (sessionStorage.getItem(DEMO_LIVE_ONBOARD_KEY)) return;
      sessionStorage.setItem(DEMO_LIVE_ONBOARD_KEY, "1");
    } catch {
      return;
    }
    navigate(`/race/${raceUuid}/heat/1`, { replace: true });
  }, [raceUuid, navigate]);

  const race = useMemo(
    () => races.find((r) => r.uuid === raceUuid) ?? null,
    [races, raceUuid]
  );

  useEffect(() => {
    const load = async () => {
      if (races.length === 0) await getRaces();
      setLoading(false);
    };
    load();
  }, [raceUuid, getRaces, races]);

  useEffect(() => {
    if (!loading && race) {
      getCategories(raceUuid).then((cats) => {
        if (!cats.length) createCategoriesFromRiders(raceUuid);
        setCategoriesLoaded(true);
      });
    }
  }, [loading, race, raceUuid, getCategories, createCategoriesFromRiders]);

  const resolvedImage = useMemo(() => resolveRaceImage(race?.image), [race]);
  const finalized = isRaceFinalized(race);

  // A finished race has no Start/Live phase left to enter. Race mode is UI
  // state that survives navigation, so a race finalized while it was on drops
  // back to Setup rather than rendering a start grid that can't start anything.
  useEffect(() => {
    if (finalized && isRaceMode) setRaceModeRace(null);
  }, [finalized, isRaceMode, setRaceModeRace]);

  // 0.3.2: a judge never sees Create (setup tabs, Info): the race opens on RACE,
  // a finished race on its Results. Re-checked when access arrives (accessTick).
  const judgeOnly = isJudgeOnly(raceUuid);
  useEffect(() => {
    if (!judgeOnly) return;
    if (finalized) navigate(`/race/${raceUuid}/results`, { replace: true });
    else if (!isRaceMode) setRaceModeRace(raceUuid);
  }, [judgeOnly, finalized, isRaceMode, raceUuid, setRaceModeRace, navigate]);

  // Editing riders is impossible once finalized — leave the editor if it's open.
  useEffect(() => {
    if (finalized && ridersEdit) setRidersEdit(false);
  }, [finalized, ridersEdit]);

  if (loading) return <div className={styles.loading}>Loading race...</div>;
  if (!race) return <div className={styles.loading}>Race not found.</div>;

  // Shared race: only the screens this member may view.
  const visibleTabs: readonly Tab[] = (finalized ? FINALIZED_TABS : TABS).filter(
    (tab) => canViewScreen(raceUuid, tab)
  );
  const activeTabSafe = (
    visibleTabs.includes(activeTab as Tab) ? activeTab : visibleTabs[0]
  ) as Tab;

  return (
    <div className={styles.race}>
      <HeaderRace>
        {/* RACE screen: the owner's Invite Judges (working access; public results are shared from Board / Results). */}
        {serverConfigured && isRaceMode && race && (
          <Suspense fallback={null}>
            <InviteJudges raceUuid={raceUuid} raceName={race.name} />
          </Suspense>
        )}
      </HeaderRace>
      {/* Hero (image + race card) belongs to Create only; Race mode goes straight to work. */}
      {!isRaceMode && (
      <div className={styles.top}>
        <div className={styles.imageWrapper}>
          <img
            src={resolvedImage}
            alt="Race"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover"
            }}
          />
        </div>
        <div className={styles.raceInfo}>
          <RaceInfo {...race} />
        </div>
      </div>
      )}

      <div className={styles.bottom}>
        {isRaceMode && !finalized ? (
          categoriesLoaded && filteredCategories.length === 0 ? (
            // Nothing to run yet, and Race mode has no tabs: point at where riders are added.
            <div className={styles.emptyRace} data-testid="race-mode-empty">
              <p>This race has no riders yet.</p>
              <button
                type="button"
                className={styles.emptyRaceBtn}
                data-testid="race-mode-add-riders"
                onClick={() => { setActiveTab("riders"); setRaceModeRace(null); }}
              >
                Add riders
              </button>
            </div>
          ) : (
            <RaceMode raceUuid={raceUuid} categories={filteredCategories.filter((c) => !c.ignored)} />
          )
        ) : (
          <>
            <div className={styles.tabs} role="group" aria-label="Create sections">
              {visibleTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`${styles.button} ${activeTabSafe === tab ? styles.activeTab : ""}`}
                  aria-pressed={activeTabSafe === tab}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            {finalized && (
              <div className={styles.finalBanner} data-testid="race-final-banner">
                <Lock size={16} className={styles.finalBannerIcon} aria-hidden="true" />
                <span>
                  <strong>Final results.</strong> This race was closed on{" "}
                  {new Date(race.finalized!.at).toLocaleDateString()} — results can be
                  viewed and exported, but not changed.
                </span>
              </div>
            )}
            {live && (
              <Suspense fallback={null}>
                <SyncBadge raceUuid={raceUuid} />
                <ShareRace raceUuid={raceUuid} raceName={race.name} />
              </Suspense>
            )}
            {serverConfigured && !live && raceUuid !== DEMO_RACE_UUID && (
              <Suspense fallback={null}>
                <LocalOnlyBadge raceUuid={raceUuid} />
                {!race.viewOnly && !finalized && <ShareRace raceUuid={raceUuid} raceName={race.name} />}
              </Suspense>
            )}
            <div className={styles.tabContent}>
              {activeTabSafe === "schedule" && (
                <Schedule raceUuid={raceUuid} categories={filteredCategories} />
              )}
              {activeTabSafe === "categories" && (
                <Categories raceUuid={raceUuid} />
              )}
              {activeTabSafe === "riders" &&
                (ridersEdit && !finalized ? (
                  <EditRiders
                    raceUuid={raceUuid}
                    categories={filteredCategories}
                    onBack={() => setRidersEdit(false)}
                  />
                ) : (
                  <Riders
                    raceUuid={raceUuid}
                    categories={filteredCategories}
                    // No edit entry point at all on a finished race — the store
                    // would reject the writes anyway.
                    onEditMode={finalized ? undefined : () => setRidersEdit(true)}
                    readOnly={finalized}
                  />
                ))}
              {activeTabSafe === "map" && (
                <Suspense fallback={<Loader />}>
                  <Map raceUuid={raceUuid} />
                </Suspense>
              )}
              {/* Cloud tab hidden for now */}
              {activeTabSafe === "info" && (
                <Info
                  race={race}
                  onDeleteRace={async () => {
                    if (!canForRace(raceUuid, "DELETE_RACE")) {
                      alert("No permission to delete this race");
                      return;
                    }
                    // Race first: `deleteRace` already purges this race's
                    // riders and categories from IndexedDB, and removing the
                    // race lifts the finalized lock so the Zustand-cache
                    // cleanup below isn't rejected for a finished race.
                    if (isLiveRace(raceUuid)) {
                      // Shared race (server keeps every row): the owner deleting an ACTIVE race
                      // removes it for everyone; a finished race, or a member's delete, only
                      // hides it for this user. Offline, the delete is queued; the copy goes now.
                      const live = await import("@/services/live/liveClient");
                      try {
                        const outcome = await live.deleteSharedRace(raceUuid);
                        if (outcome === "hidden") {
                          // Not the creator (0.2) or a finished race: only this user's list changed.
                          alert("Removed from your races. It stays for everyone else — only its creator can delete it.");
                        }
                      } catch (e) {
                        alert(`Could not delete the race: ${e instanceof Error ? e.message : String(e)}`);
                        return;
                      }
                      navigate("/main");
                      return;
                    }
                    await deleteRace(raceUuid);
                    await deleteRidersByRace(raceUuid);
                    // Back to the races list, NOT the marketing landing. /main
                    // shows the list when races remain, or its Create-Race /
                    // Use-Demo empty view when this was the last one (user req).
                    navigate("/main");
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Race;
