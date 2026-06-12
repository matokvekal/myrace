import React, { useState } from "react";
import styles from "./downloadRace.module.css";
import Button from "@/components/ui/Button";
import { Search, Lock, Download, X } from "lucide-react";
import { searchPublicRaces, downloadRace } from "@/services/RaceSync";
import { RaceProps } from "@/types/types";
import useRaceStore from "@/stores/racesStore";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

type Tab = "public" | "private";

const DownloadRace: React.FC<Props> = ({ onClose, onSuccess }) => {
  const [activeTab, setActiveTab] = useState<Tab>("public");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const [raceId, setRaceId] = useState("");
  const [password, setPassword] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const { updateRace } = useRaceStore();
  const { insertRiders } = useRiderStore();
  const { categories, updateCategory } = useCategoryStore();

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    setError("");

    try {
      const result = await searchPublicRaces(searchQuery);
      if (result.success && result.results) {
        setSearchResults(result.results);
      } else {
        setError(result.error || "Search failed");
      }
    } catch (err) {
      setError("Search failed");
    } finally {
      setSearching(false);
    }
  };

  const handleDownloadPublic = async (raceIdToDownload: string) => {
    await handleDownload(raceIdToDownload);
  };

  const handleDownloadPrivate = async () => {
    if (!raceId.trim()) {
      setError("Please enter race ID");
      return;
    }
    await handleDownload(raceId, password || undefined);
  };

  const handleDownload = async (raceIdToDownload: string, pwd?: string) => {
    setDownloading(true);
    setError("");

    try {
      const result = await downloadRace(raceIdToDownload, pwd);

      if (!result.success) {
        setError(result.error || "Download failed");
        setDownloading(false);
        return;
      }

      if (!result.data) {
        setError("No data received");
        setDownloading(false);
        return;
      }

      const { race, categories: raceCategories, riders } = result.data;

      // Check if race already exists locally
      const existingRaces = await useRaceStore.getState().getRaces();
      const exists = existingRaces.some(
        (r: RaceProps) => r.raceId === raceIdToDownload
      );

      if (exists) {
        if (
          !window.confirm(
            "This race already exists locally. Overwrite with server version?"
          )
        ) {
          setDownloading(false);
          return;
        }
      }

      // Save race
      await updateRace(race);

      // Save categories
      for (const cat of raceCategories) {
        const existingCat = categories.find(
          (c) =>
            c.raceUuid === race.uuid &&
            c.name === cat.name &&
            c.subCategory === cat.subCategory
        );
        if (!existingCat) {
          updateCategory(cat);
        }
      }

      // Save riders
      if (riders.length > 0) {
        await insertRiders(riders);
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError("Download failed: " + String(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Download Race</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === "public" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("public")}
          >
            <Search size={16} />
            Public Races
          </button>
          <button
            className={`${styles.tab} ${activeTab === "private" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("private")}
          >
            <Lock size={16} />
            Private Race
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {activeTab === "public" ? (
          <div className={styles.tabContent}>
            <div className={styles.searchBar}>
              <input
                className={styles.searchInput}
                placeholder="Search by name, location, or race ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button
                variant="primary"
                size="md"
                onClick={handleSearch}
                disabled={searching}
                startIcon={<Search size={16} />}
              >
                {searching ? "Searching..." : "Search"}
              </Button>
            </div>

            <div className={styles.results}>
              {searchResults.length === 0 && !searching && searchQuery && (
                <div className={styles.empty}>No races found</div>
              )}

              {searchResults.map((result) => (
                <div key={result.raceId} className={styles.resultCard}>
                  <div className={styles.resultInfo}>
                    <div className={styles.resultName}>{result.name}</div>
                    <div className={styles.resultMeta}>
                      {result.date} · {result.location}
                    </div>
                    <div className={styles.resultDetails}>
                      <span className={styles.raceId}>{result.raceId}</span>
                      <span className={styles.riders}>
                        {result.ridersCount} riders
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => handleDownloadPublic(result.raceId)}
                    disabled={downloading}
                    startIcon={<Download size={14} />}
                  >
                    Download
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.tabContent}>
            <div className={styles.privateForm}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Race ID *</label>
                <input
                  className={styles.input}
                  placeholder="e.g., 2026-06-12-mountain-race or anbh1123"
                  value={raceId}
                  onChange={(e) => setRaceId(e.target.value)}
                />
                <span className={styles.hint}>
                  Enter the race ID shared by the commissaire
                </span>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Password</label>
                <input
                  className={styles.input}
                  type="password"
                  placeholder="Enter password if required"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleDownloadPrivate()
                  }
                />
              </div>

              <Button
                variant="success"
                size="lg"
                fullWidth
                onClick={handleDownloadPrivate}
                disabled={downloading || !raceId.trim()}
                startIcon={<Download size={18} />}
              >
                {downloading ? "Downloading..." : "Download Race"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DownloadRace;
