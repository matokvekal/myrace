import React, { useEffect, useMemo, useRef, useState } from "react";
import useRaceStore from "@/stores/racesStore";
import useCategoryStore from "@/stores/categoryStore";
import RaceMap from "@/components/map/RaceMap";
import { getRaceTracks, newTrack } from "@/utils/raceTracks";
import type { RaceTrack } from "@/types/types";
import { Plus, X } from "lucide-react";
import MapCard from "./MapCard";
import DrawRoute from "./DrawRoute";
import PlaceSearch from "./PlaceSearch";
import styles from "./map.module.css";

interface MapProps {
  raceUuid: string;
}

const FALLBACK_CENTER = { lat: 40.7829, lng: -73.9654 }; // Central Park, New York
const SAVE_DELAY_MS = 500;

/**
 * A race's course maps. Two steps: Add map (name + place → Create), then Draw
 * route on a full-screen map. Every change saves on its own (no Save / Reset).
 */
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

  const [tracks, setTracks] = useState<RaceTrack[]>(() => getRaceTracks(race));
  const [drawingId, setDrawingId] = useState<string | null>(null);

  // ── Autosave: the race's tracks follow every change, shortly after it ──
  const firstRun = useRef(true);
  const pending = useRef<RaceTrack[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    const current = useRaceStore.getState().races.find((r) => r.uuid === raceUuid);
    if (next && current) void updateRace({ ...current, tracks: next });
  };
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    pending.current = tracks;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks]);
  // Leaving the tab saves anything still pending.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), []);

  // ── Step 1: create a map (name + place) ──
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [focus, setFocus] = useState<{ lat: number; lng: number } | undefined>();
  const viewRef = useRef<{ center: { lat: number; lng: number }; zoom: number } | null>(null);

  if (!race) {
    return <div style={{ padding: 20, textAlign: "center" }}>Loading race…</div>;
  }

  const patchTrack = (id: string, patch: Partial<RaceTrack>) =>
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const deleteMap = (id: string) => setTracks((prev) => prev.filter((t) => t.id !== id));

  const createMap = () => {
    const view = viewRef.current;
    const t: RaceTrack = {
      ...newTrack(tracks.length),
      header: newName.trim() || undefined,
      ...(view ? { center: view.center, zoom: view.zoom } : {}),
    };
    setTracks((prev) => [...prev, t]);
    setCreating(false);
    setNewName("");
    setFocus(undefined);
    viewRef.current = null;
    setDrawingId(t.id); // straight to step 2
  };

  const drawingIndex = tracks.findIndex((t) => t.id === drawingId);

  return (
    <div className={styles.wrap}>
      <div className={styles.pageBar}>
        <span className={styles.pageTitle}>Maps{tracks.length > 0 ? ` · ${tracks.length}` : ""}</span>
        <div className={styles.spacer} />
        {!creating && (
          <button className={styles.btnPrimary} onClick={() => setCreating(true)} data-testid="add-map">
            <Plus size={14} /> Add map
          </button>
        )}
      </div>

      {creating && (
        <section className={styles.card} data-testid="create-map">
          <div className={styles.cardHead}>
            <span className={styles.fixedName}>Map {tracks.length + 1}</span>
            <input
              className={styles.headerInput}
              dir="auto"
              autoFocus
              placeholder="Name (e.g. Elite course)"
              aria-label="Map name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button className={styles.tool} onClick={() => setCreating(false)} aria-label="Cancel" title="Cancel">
              <X size={16} />
            </button>
          </div>
          <PlaceSearch onPick={(p) => setFocus({ lat: p.lat, lng: p.lng })} />
          <div className={styles.mapBox}>
            <RaceMap
              bare
              center={focus ?? race.mapCenter ?? FALLBACK_CENTER}
              zoom={focus ? 15 : race.mapZoom ?? 13}
              trackPoints={[]}
              markers={[]}
              onViewChange={(c, z) => {
                viewRef.current = { center: c, zoom: z };
              }}
            />
          </div>
          <button className={styles.btnPrimary} onClick={createMap} data-testid="create-map-btn">
            Create map
          </button>
        </section>
      )}

      {tracks.length === 0 && !creating ? (
        <div className={styles.hint}>No maps yet. Add one per course.</div>
      ) : (
        tracks.map((t, i) => (
          <MapCard
            key={t.id}
            index={i}
            track={t}
            categories={categories}
            location={race.location}
            onChange={(patch) => patchTrack(t.id, patch)}
            onDelete={() => deleteMap(t.id)}
            onDraw={() => setDrawingId(t.id)}
          />
        ))
      )}

      {/* ── Step 2: draw the route, full screen ── */}
      {drawingIndex >= 0 && (
        <DrawRoute
          key={tracks[drawingIndex].id}
          index={drawingIndex}
          track={tracks[drawingIndex]}
          onChange={(patch) => patchTrack(tracks[drawingIndex].id, patch)}
          onClose={() => setDrawingId(null)}
        />
      )}
    </div>
  );
};

export default Map;
