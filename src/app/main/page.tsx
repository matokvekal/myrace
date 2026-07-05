import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./main.module.css";
import AddRace from "./addRace/AddRace";
import HeaderMain from "./components/headerMain/HeaderMain";
import EmptyRaces from "./components/emptyRaces/EmptyRaces";
import RaceCard from "./components/raceCard/RaceCard";
import RaceTile from "./components/raceTile/RaceTile";
import DownloadRace from "./components/downloadRace/DownloadRace";
import CloudRacesSection from "@/components/cloud/CloudRacesSection";
import Button from "@/components/ui/Button";
import useRaceStore from "@/stores/racesStore";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import { seedDemoRace, DEMO_RACE_UUID } from "@/utils/demoSeed";
import {
  ArrowLeft,
  ArrowUpDown,
  Download,
  Heart,
  Plus,
  Search
} from "lucide-react";

type SortKey = "date" | "status";
const STATUS_ORDER: Record<string, number> = {
  running: 0,
  upcoming: 1,
  finished: 2
};

const MainPage = () => {
  const navigate = useNavigate();
  const [addNewRace, setAddNewRace] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [riderCounts, setRiderCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const { races, getRaces, updateRace } = useRaceStore();

  useEffect(() => {
    getRaces().then(() => setLoaded(true));
  }, [getRaces]);

  useEffect(() => {
    if (!loaded || races.length === 0) return;
    initIndexedDB().then((db) =>
      db.getAll("riders").then((all) => {
        const counts: Record<string, number> = {};
        for (const rider of all) {
          counts[rider.raceUuid] = (counts[rider.raceUuid] ?? 0) + 1;
        }
        setRiderCounts(counts);
        db.close();
      })
    );
  }, [loaded, races.length]);

  const handleToggleFavorite = (uuid: string) => {
    const race = races.find((r) => r.uuid === uuid);
    if (race) updateRace({ ...race, isFavorite: !race.isFavorite });
  };

  const handleLoadDemo = async () => {
    setLoadingDemo(true);
    try {
      await seedDemoRace();
      navigate(`/race/${DEMO_RACE_UUID}`);
    } finally {
      setLoadingDemo(false);
    }
  };

  const isEmpty = loaded && races.length === 0;

  // Sorted newest-first
  const myRaces = [...races].sort((a, b) => b.id - a.id);

  // Filtered + sorted for "See All" list
  const allFiltered = races
    .filter((r) => {
      if (showFavoritesOnly && !r.isFavorite) return false;
      return r.name.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) =>
      sortBy === "date"
        ? b.id - a.id
        : (STATUS_ORDER[a.status ?? "upcoming"] ?? 1) -
          (STATUS_ORDER[b.status ?? "upcoming"] ?? 1)
    );

  if (addNewRace) {
    return <AddRace setAddNewwRace={setAddNewRace} />;
  }

  return (
    <div className={styles.main}>
      <HeaderMain />

      {isEmpty ? (
        <>
          {/* invited users land here with no local races yet */}
          <CloudRacesSection />
          <EmptyRaces
            onCreateRace={() => setAddNewRace(true)}
            onLoadDemo={handleLoadDemo}
            loadingDemo={loadingDemo}
          />
        </>
      ) : showAll ? (
        /* ── Full list view ── */
        <div className={styles.content}>
          <div className={styles.toolbar}>
            <div className={styles.toolbarTop}>
              <button className={styles.backBtn} onClick={() => setShowAll(false)}>
                <ArrowLeft width={16} height={16} />
                My Races
              </button>
              <Button
                variant="success"
                size="md"
                className={styles.addBtn}
                onClick={() => setAddNewRace(true)}
              >
                <Plus width={15} height={15} />
                Add
              </Button>
            </div>

            <div className={styles.searchWrap}>
              <Search className={styles.searchIcon} aria-hidden="true" />
              <input
                className={styles.search}
                placeholder="Search races..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className={styles.toolbarActions}>
              <div className={styles.toolbarLeft}>
                <Button
                  variant="secondary"
                  size="md"
                  className={styles.iconBtn}
                  onClick={() => setSortBy(sortBy === "date" ? "status" : "date")}
                >
                  <ArrowUpDown className={styles.iconGlyph} aria-hidden="true" />
                  <span>{sortBy === "date" ? "Date" : "Status"}</span>
                </Button>
                <Button
                  variant="icon"
                  size="md"
                  iconOnly
                  className={`${styles.iconBtn} ${showFavoritesOnly ? styles.heartActive : ""}`}
                  onClick={() => setShowFavoritesOnly((v) => !v)}
                  aria-label="Show favorites"
                >
                  <Heart
                    className={styles.heartIcon}
                    aria-hidden="true"
                    fill={showFavoritesOnly ? "currentColor" : "none"}
                  />
                </Button>
              </div>
              <Button
                variant="primary"
                size="md"
                className={styles.downloadBtn}
                onClick={() => setShowDownload(true)}
              >
                <Download className={styles.iconGlyph} aria-hidden="true" />
                Download
              </Button>
            </div>
          </div>

          <div className={styles.list}>
            {allFiltered.map((race) => (
              <RaceCard
                key={race.uuid}
                id={race.id}
                uuid={race.uuid}
                name={race.name}
                time={race.time}
                date={race.date}
                image={race.image}
                location={race.location}
                ridersCount={riderCounts[race.uuid] ?? 0}
                status={race.status}
                curentHeat={race.heat}
                isFavorite={race.isFavorite}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </div>
        </div>
      ) : (
        /* ── Home / App Store view ── */
        <div className={styles.home}>

          {/* My Races section */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionLeft}>
                <span className={styles.sectionTitle}>My Races</span>
                <span className={styles.sectionCount}>{races.length}</span>
              </div>
              <div className={styles.sectionActions}>
                <button className={styles.seeAllBtn} onClick={() => setShowAll(true)}>
                  See All
                </button>
                <button className={styles.addTileBtn} onClick={() => setAddNewRace(true)}>
                  <Plus width={13} height={13} />
                  Add
                </button>
              </div>
            </div>

            <div className={styles.tileRow}>
              {myRaces.map((race) => (
                <RaceTile
                  key={race.uuid}
                  id={race.id}
                  uuid={race.uuid}
                  name={race.name}
                  time={race.time}
                  date={race.date}
                  image={race.image}
                  location={race.location}
                  ridersCount={riderCounts[race.uuid] ?? 0}
                  status={race.status}
                  curentHeat={race.heat}
                  isFavorite={race.isFavorite}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          </div>

          {/* Shared cloud races (renders nothing when cloud is off) */}
          <CloudRacesSection />

          {/* Discover / Download section */}
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div className={styles.sectionLeft}>
                <span className={styles.sectionTitle}>Other Bike Races</span>
              </div>
            </div>

            <div className={styles.discoverCard} onClick={() => setShowDownload(true)}>
              <Download width={22} height={22} className={styles.discoverIcon} />
              <div className={styles.discoverText}>
                <div className={styles.discoverTitle}>Download a Race</div>
                <div className={styles.discoverSub}>Get race data from the server</div>
              </div>
            </div>
          </div>

        </div>
      )}

      {showDownload && (
        <DownloadRace
          onClose={() => setShowDownload(false)}
          onSuccess={() => {
            getRaces();
            setShowDownload(false);
          }}
        />
      )}
    </div>
  );
};

export default MainPage;
