import React, { useEffect, useMemo, useState } from "react";
import useRaceStore from "@/stores/racesStore";
import useCategoryStore from "@/stores/categoryStore";
import { getRaceTracks, newTrack } from "@/utils/raceTracks";
import { buildSchedule, DEFAULT_WAVE_GAP_MINUTES } from "../schedule/Schedule";
import type { RaceTrack } from "@/types/types";
import { toast } from "react-toastify";
import { Plus, Save, RotateCcw } from "lucide-react";
import MapCard from "./MapCard";
import styles from "./map.module.css";

interface MapProps {
  raceUuid: string;
}

/** All of a race's course maps on one scrolling page — one card per map. */
const Map: React.FC<MapProps> = ({ raceUuid }) => {
  const races = useRaceStore((s) => s.races);
  const updateRace = useRaceStore((s) => s.updateRace);
  const race = useMemo(() => races.find((r) => r.uuid === raceUuid), [races, raceUuid]);

  const allCategories = useCategoryStore((s) => s.categories);
  const getCategories = useCategoryStore((s) => s.getCategories);
  // The store only holds what has been loaded; make sure this race's categories are in it
  useEffect(() => {
    getCategories(raceUuid);
  }, [raceUuid, getCategories]);

  const categories = useMemo(
    () => allCategories.filter((c) => c.raceUuid === raceUuid),
    [allCategories, raceUuid]
  );
  // Categories in schedule order, grouped by wave — the order the day runs in
  const waveGroups = useMemo(
    () =>
      [...buildSchedule(categories, DEFAULT_WAVE_GAP_MINUTES).entries()].map(([waveNum, startMap]) => ({
        waveNum,
        cats: [...startMap.values()].flat(),
      })),
    [categories]
  );

  const [tracks, setTracks] = useState<RaceTrack[]>(() => getRaceTracks(race));
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  if (!race) {
    return <div style={{ padding: 20, textAlign: "center" }}>Loading race…</div>;
  }

  const patchTrack = (id: string, patch: Partial<RaceTrack>) => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setDirty(true);
  };

  const addMap = () => {
    const t = newTrack(tracks.length);
    setTracks((prev) => [...prev, t]);
    setJustAddedId(t.id);
    setDirty(true);
  };

  const deleteMap = (id: string) => {
    setTracks((prev) => prev.filter((t) => t.id !== id));
    setDirty(true);
  };

  const handleSave = async () => {
    await updateRace({ ...race, tracks });
    setDirty(false);
    toast.success("Race maps saved");
  };

  const handleReset = () => {
    setTracks(getRaceTracks(race));
    setJustAddedId(null);
    setDirty(false);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.pageBar}>
        <h3 className={styles.pageTitle}>Maps</h3>
        <div className={styles.spacer} />
        {dirty && (
          <button className={styles.btnGhost} onClick={handleReset}>
            <RotateCcw size={14} /> Reset
          </button>
        )}
        <button className={styles.btnPrimary} onClick={handleSave} disabled={!dirty}>
          <Save size={14} /> Save
        </button>
        <button className={styles.btn} onClick={addMap}>
          <Plus size={14} /> Add map
        </button>
      </div>

      {tracks.length === 0 ? (
        <div className={styles.hint}>
          No maps yet. Press <b>Add map</b>, then upload a track file or draw one — add a map for each
          course (e.g. Elite, Kids, Katkatim).
        </div>
      ) : (
        tracks.map((t) => (
          <MapCard
            key={t.id}
            track={t}
            categories={categories}
            waveGroups={waveGroups}
            location={race.location}
            startEditing={t.id === justAddedId}
            onChange={(patch) => patchTrack(t.id, patch)}
            onDelete={() => deleteMap(t.id)}
          />
        ))
      )}
    </div>
  );
};

export default Map;
