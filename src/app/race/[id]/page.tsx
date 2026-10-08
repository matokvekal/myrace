import React, { useState, useEffect, useMemo, Suspense, lazy } from "react";
import styles from "./race.module.css";
import HeaderRace from "../components/headerRace/HeaderRace";
import Button from "@/components/ui/Button";
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
import Results from "./results/Results";
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

const TABS = [
  "schedule",
  "categories",
  "riders",
  "results",
  "map",
  // "cloud", // hidden for now
  "info"
] as const;
type Tab = (typeof TABS)[number];

/**
 * Tabs a FINALIZED race still shows. Schedule and Categories are setup tools
 * for a race that hasn't happened yet — on a closed race they'd offer edits
 * that silently do nothing, so they're dropped and Results leads instead.
 */
const FINALIZED_TABS: Tab[] = ["results", "riders", "map", "info"];

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

  const isRaceMode = useUIStore((s) => s.isRaceMode);
  const setRaceMode = useUIStore((s) => s.setRaceMode);
  const { activeTab, setActiveTab } = useDataStore();

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
      });
    }
  }, [loading, race, raceUuid, getCategories, createCategoriesFromRiders]);

  const resolvedImage = useMemo(() => resolveRaceImage(race?.image), [race]);
  const finalized = isRaceFinalized(race);

  // A finished race has no Start/Live phase left to enter. Race mode is UI
  // state that survives navigation, so a race finalized while it was on drops
  // back to Setup rather than rendering a start grid that can't start anything.
  useEffect(() => {
    if (finalized && isRaceMode) setRaceMode(false);
  }, [finalized, isRaceMode, setRaceMode]);

  // Editing riders is impossible once finalized — leave the editor if it's open.
  useEffect(() => {
    if (finalized && ridersEdit) setRidersEdit(false);
  }, [finalized, ridersEdit]);

  if (loading) return <div className={styles.loading}>Loading race...</div>;
  if (!race) return <div className={styles.loading}>Race not found.</div>;

  const visibleTabs: readonly Tab[] = finalized ? FINALIZED_TABS : TABS;
  const activeTabSafe = (
    visibleTabs.includes(activeTab as Tab) ? activeTab : visibleTabs[0]
  ) as Tab;

  return (
    <div className={styles.race}>
      <div className={`${styles.top} ${isRaceMode ? styles.topCompact : ""}`}>
        <div className={styles.headerRaceWrapper}>
          <HeaderRace />
        </div>
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
        {!isRaceMode && (
          <div className={styles.raceInfo}>
            <RaceInfo {...race} />
          </div>
        )}
      </div>

      <div className={styles.bottom}>
        {isRaceMode && !finalized ? (
          <RaceMode raceUuid={raceUuid} categories={filteredCategories} />
        ) : (
          <>
            {finalized && (
              <div className={styles.finalBanner} data-testid="race-final-banner">
                <span className={styles.finalBannerIcon} aria-hidden="true">🔒</span>
                <span>
                  <strong>Final results.</strong> This race was closed on{" "}
                  {new Date(race.finalized!.at).toLocaleDateString()} — results can be
                  viewed and exported, but not changed.
                </span>
              </div>
            )}
            <div className={styles.tabs}>
              {visibleTabs.map((tab) => (
                <Button
                  key={tab}
                  variant={activeTabSafe === tab ? "primary" : "secondary"}
                  size="sm"
                  className={`${styles.button} ${activeTabSafe === tab ? styles.activeTab : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </Button>
              ))}
            </div>

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
              {activeTabSafe === "results" && <Results raceUuid={raceUuid} />}
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
