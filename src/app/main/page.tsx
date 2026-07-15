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

type SortKey = "date" | "name" | "status";
const SORT_CYCLE: SortKey[] = ["date", "name", "status"];
const SORT_LABEL: Record<SortKey, string> = {
  date: "Date",
  name: "Name",
  status: "Status"
};
const STATUS_ORDER: Record<string, number> = {
  running: 0,
  upcoming: 1,
  finished: 2
};

// Race dates are stored as "DD/MM/YYYY" (demo/new races) but tolerate ISO too.
const parseRaceDate = (d: string | null | undefined): number => {
  if (!d) return 0;
  const dm = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dm) return new Date(+dm[3], +dm[2] - 1, +dm[1]).getTime();
  const t = Date.parse(d);
  return Number.isNaN(t) ? 0 : t;
};

// How many recent races the home row shows before "See All" takes over
const HOME_ROW_LIMIT = 10;

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
      await seedDemoRace(true);
      navigate(`/race/${DEMO_RACE_UUID}`);
    } finally {
      setLoadingDemo(false);
    }
  };

  const isEmpty = loaded && races.length === 0;

  // Home row: most recent races only — the full list lives behind "See All"
  const myRaces = [...races]
    .sort((a, b) => (parseRaceDate(b.date) - parseRaceDate(a.date)) || (b.id - a.id))
    .slice(0, HOME_ROW_LIMIT);

  // Filtered + sorted for "See All" list — search matches name, location or date
  const q = search.trim().toLowerCase();
  const allFiltered = races
    .filter((r) => {
      if (showFavoritesOnly && !r.isFavorite) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.location ?? "").toLowerCase().includes(q) ||
        (r.date ?? "").includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "status")
        return (
          (STATUS_ORDER[a.status ?? "upcoming"] ?? 1) -
            (STATUS_ORDER[b.status ?? "upcoming"] ?? 1) ||
          parseRaceDate(b.date) - parseRaceDate(a.date)
        );
      return (parseRaceDate(b.date) - parseRaceDate(a.date)) || (b.id - a.id);
    });

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
                dir="auto"
                placeholder="Search by name, date or location..."
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
                  onClick={() =>
                    setSortBy(
                      SORT_CYCLE[(SORT_CYCLE.indexOf(sortBy) + 1) % SORT_CYCLE.length]
                    )
                  }
                  title="Sort by date / name / status"
                >
                  <ArrowUpDown className={styles.iconGlyph} aria-hidden="true" />
                  <span>{SORT_LABEL[sortBy]}</span>
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
            {allFiltered.length === 0 && (
              <div className={styles.noResults} dir="auto">
                No races match &ldquo;{search}&rdquo;
              </div>
            )}
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
