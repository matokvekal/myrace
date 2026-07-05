import React, { useMemo, useRef, useState } from "react";
import useRaceStore from "@/stores/racesStore";
import RaceMap from "@/components/map/RaceMap";
import { parseTrackFile, centerOfPoints } from "@/utils/parseTrack";
import type { TrackMarker } from "@/types/types";
import { toast } from "react-toastify";
import { Upload, MapPin, Crosshair, Trash2, Save, RotateCcw } from "lucide-react";
import styles from "./map.module.css";

interface MapProps {
  raceUuid: string;
}

const Map: React.FC<MapProps> = ({ raceUuid }) => {
  const races = useRaceStore((s) => s.races);
  const updateRace = useRaceStore((s) => s.updateRace);
  const race = useMemo(() => races.find((r) => r.uuid === raceUuid), [races, raceUuid]);

  const fileRef = useRef<HTMLInputElement>(null);
  // Latest map view (updated on every pan/zoom) — captured by "Set race area".
  const viewRef = useRef<{ center: { lat: number; lng: number }; zoom: number } | null>(null);

  const [trackPoints, setTrackPoints] = useState<[number, number][]>(race?.trackPoints ?? []);
  const [markers, setMarkers] = useState<TrackMarker[]>(race?.mapMarkers ?? []);
  const [center, setCenter] = useState<{ lat: number; lng: number } | undefined>(race?.mapCenter);
  const [zoom, setZoom] = useState<number | undefined>(race?.mapZoom);
  const [addMode, setAddMode] = useState(false);
  const [dirty, setDirty] = useState(false);

  if (!race) {
    return <div style={{ padding: 20, textAlign: "center" }}>Loading race…</div>;
  }

  const markDirty = () => setDirty(true);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const text = await file.text();
      const parsed = parseTrackFile(file.name, text);
      setTrackPoints(parsed.points);
      if (parsed.markers.length) {
        setMarkers((prev) => [...prev, ...parsed.markers]);
      }
      const c = centerOfPoints(parsed.points) ?? centerOfPoints(parsed.markers.map((m) => [m.lat, m.lng]));
      if (c) {
        setCenter(c);
        setZoom(15);
      }
      markDirty();
      toast.success(
        `Loaded ${parsed.points.length} track points` +
          (parsed.markers.length ? ` and ${parsed.markers.length} waypoints` : "")
      );
    } catch (err) {
      toast.error(`Could not read track: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    if (!addMode) return;
    const label = window.prompt("Point label:", `Point ${markers.length + 1}`);
    if (label === null) return;
    setMarkers((prev) => [...prev, { lat, lng, label: label.trim() || `Point ${prev.length + 1}`, type: "point" }]);
    markDirty();
  };

  const handleViewChange = (c: { lat: number; lng: number }, z: number) => {
    viewRef.current = { center: c, zoom: z };
  };

  const setAreaToCurrentView = () => {
    if (!viewRef.current) return;
    setCenter(viewRef.current.center);
    setZoom(viewRef.current.zoom);
    markDirty();
    toast.info("Race area set to current map view");
  };

  const clearTrack = () => {
    setTrackPoints([]);
    markDirty();
  };

  const clearMarkers = () => {
    setMarkers([]);
    markDirty();
  };

  const removeMarker = (idx: number) => {
    setMarkers((prev) => prev.filter((_, i) => i !== idx));
    markDirty();
  };

  const handleSave = async () => {
    await updateRace({
      ...race,
      trackPoints,
      mapMarkers: markers,
      mapCenter: center,
      mapZoom: zoom,
    });
    setDirty(false);
    toast.success("Race map saved");
  };

  const handleReset = () => {
    setTrackPoints(race.trackPoints ?? []);
    setMarkers(race.mapMarkers ?? []);
    setCenter(race.mapCenter);
    setZoom(race.mapZoom);
    setAddMode(false);
    setDirty(false);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button className={styles.btn} onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> Upload track
        </button>
        <button
          className={`${styles.btn} ${addMode ? styles.btnActive : ""}`}
          onClick={() => setAddMode((v) => !v)}
        >
          <MapPin size={14} /> {addMode ? "Click map to add…" : "Add point"}
        </button>
        <button className={styles.btn} onClick={setAreaToCurrentView}>
          <Crosshair size={14} /> Set race area
        </button>
        {trackPoints.length > 0 && (
          <button className={styles.btnGhost} onClick={clearTrack}>
            <Trash2 size={14} /> Clear track
          </button>
        )}
        {markers.length > 0 && (
          <button className={styles.btnGhost} onClick={clearMarkers}>
            <Trash2 size={14} /> Clear points
          </button>
        )}
        <div className={styles.spacer} />
        {dirty && (
          <button className={styles.btnGhost} onClick={handleReset}>
            <RotateCcw size={14} /> Reset
          </button>
        )}
        <button className={styles.btnPrimary} onClick={handleSave} disabled={!dirty}>
          <Save size={14} /> Save
        </button>
      </div>

      <div className={styles.hint}>
        Upload a GPX / TCX / GeoJSON / JSON track from Garmin or any GPS app, pan &amp; zoom to your
        course, then <b>Set race area</b>. Use <b>Add point</b> to drop start, feed zones, or markers.
      </div>

      <div className={styles.mapBox}>
        <RaceMap
          bare
          editable={addMode}
          center={center}
          zoom={zoom}
          trackPoints={trackPoints}
          markers={markers}
          location={race.location}
          onMapClick={handleMapClick}
          onViewChange={handleViewChange}
        />
      </div>

      {markers.length > 0 && (
        <div className={styles.markerList}>
          <div className={styles.markerListTitle}>Points ({markers.length})</div>
          {markers.map((m, i) => (
            <div key={i} className={styles.markerRow}>
              <MapPin size={14} className={styles.markerIcon} />
              <span className={styles.markerLabel}>{m.label}</span>
              <span className={styles.markerCoords}>
                {m.lat.toFixed(5)}, {m.lng.toFixed(5)}
              </span>
              <button className={styles.markerRemove} onClick={() => removeMarker(i)}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".gpx,.tcx,.xml,.json,.geojson"
        style={{ display: "none" }}
        onChange={handleFile}
      />
    </div>
  );
};

export default Map;
