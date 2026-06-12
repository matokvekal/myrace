import { useState, useEffect } from "react";
import styles from "./main.module.css";
import AddRace from "./addRace/AddRace";
import HeaderMain from "./components/headerMain/HeaderMain";
import EmptyRaces from "./components/emptyRaces/EmptyRaces";
import RaceCard from "./components/raceCard/RaceCard";
import DownloadRace from "./components/downloadRace/DownloadRace";
import Button from "@/components/ui/Button";
import useRaceStore from "@/stores/racesStore";
import { initIndexedDB } from "@/stores/indexDb/indexedDbHelper";
import {
  ArrowUpDown,
  Heart,
  Plus,
  Search,
  SlidersHorizontal,
  Download
} from "lucide-react";

type SortKey = "date" | "status";
const STATUS_ORDER: Record<string, number> = {
  running: 0,
  upcoming: 1,
  finished: 2
};

const MainPage = () => {
  const [addNewRace, setAddNewRace] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [riderCounts, setRiderCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const { races, getRaces, updateRace } = useRaceStore();

  useEffect(() => {
    getRaces().then(() => setLoaded(true));
  }, [getRaces]);

  // Load rider counts for all races once
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

  const isEmpty = loaded && races.length === 0;

  const displayed = races
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

  return (
    <div className={styles.main}>
      {addNewRace ? (
        <AddRace setAddNewwRace={setAddNewRace} />
      ) : (
        <>
          <HeaderMain />
          {isEmpty ? (
            <EmptyRaces onCreateRace={() => setAddNewRace(true)} />
          ) : (
            <div className={styles.content}>
              <div className={styles.toolbar}>
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
                      variant="icon"
                      size="md"
                      iconOnly
                      className={styles.iconBtn}
                      aria-label="Filter races"
                    >
                      <SlidersHorizontal
                        className={styles.iconGlyph}
                        aria-hidden="true"
                      />
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      className={styles.iconBtn}
                      onClick={() =>
                        setSortBy(sortBy === "date" ? "status" : "date")
                      }
                    >
                      <ArrowUpDown
                        className={styles.iconGlyph}
                        aria-hidden="true"
                      />
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
                  <Button
                    variant="success"
                    size="md"
                    className={styles.addBtn}
                    onClick={() => setAddNewRace(true)}
                  >
                    <Plus className={styles.iconGlyph} aria-hidden="true" />
                    Add
                  </Button>
                </div>
              </div>

              <div className={styles.list}>
                {displayed.map((race) => (
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
          )}
        </>
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
