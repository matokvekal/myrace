import React, { useRef, useState } from "react";
import RaceMap from "@/components/map/RaceMap";
import { parseTrackFile, centerOfPoints } from "@/utils/parseTrack";
import { catWaveKey } from "../schedule/Schedule";
import type { CategoryProps, RaceTrack } from "@/types/types";
import { toast } from "react-toastify";
import {
  Pencil,
  Trash2,
  Upload,
  Route,
  MapPin,
  Undo2,
  ArrowLeftRight,
  LocateFixed,
  Crosshair,
  Check,
} from "lucide-react";
import styles from "./map.module.css";

interface WaveGroup {
  waveNum: number;
  cats: CategoryProps[];
}

interface MapCardProps {
  track: RaceTrack;
  categories: CategoryProps[];
  waveGroups: WaveGroup[];
  location?: string;
  /** Open straight in edit mode (a map that was just added). */
  startEditing?: boolean;
  onChange: (patch: Partial<RaceTrack>) => void;
  onDelete: () => void;
}

type Mode = "none" | "point" | "draw";

/**
 * One course map: name on top, the map, and Edit / Update / Delete underneath.
 * Everything else (drawing, points, direction, GPS, categories) lives behind Edit
 * so the page stays calm when several maps are stacked on it.
 */
const MapCard: React.FC<MapCardProps> = ({
  track,
  categories,
  waveGroups,
  location,
  startEditing = false,
  onChange,
  onDelete,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef<{ center: { lat: number; lng: number }; zoom: number } | null>(null);

  const [editing, setEditing] = useState(startEditing);
  const [mode, setMode] = useState<Mode>("none");
  const [catMenu, setCatMenu] = useState(false);
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  // Pan target for "My location" — not saved with the map
  const [focus, setFocus] = useState<{ lat: number; lng: number } | undefined>();
  const [locating, setLocating] = useState(false);

  const keys = track.categoryKeys ?? [];
  const ridingNames = categories
    .filter((c) => keys.includes(catWaveKey(c.name, c.subCategory)))
    .map((c) => c.name);

  const toggleCategory = (key: string) =>
    onChange({ categoryKeys: keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key] });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const parsed = parseTrackFile(file.name, await file.text());
      const c =
        centerOfPoints(parsed.points) ?? centerOfPoints(parsed.markers.map((m) => [m.lat, m.lng]));
      onChange({
        points: parsed.points,
        markers: [...track.markers, ...parsed.markers],
        ...(c ? { center: c, zoom: 15 } : {}),
        // A brand-new map takes the file's name
        ...(/^Map \d+$/.test(track.title) ? { title: file.name.replace(/\.[^.]+$/, "") } : {}),
      });
      toast.success(
        `Loaded ${parsed.points.length} track points` +
          (parsed.markers.length ? ` and ${parsed.markers.length} waypoints` : "")
      );
    } catch (err) {
      toast.error(`Could not read track: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    if (mode === "draw") {
      onChange({ points: [...track.points, [lat, lng]] });
    } else if (mode === "point") {
      const label = window.prompt("Point label:", `Point ${track.markers.length + 1}`);
      if (label === null) return;
      onChange({
        markers: [
          ...track.markers,
          { lat, lng, label: label.trim() || `Point ${track.markers.length + 1}`, type: "point" },
        ],
      });
    }
  };

  const locate = (): Promise<{ lat: number; lng: number; accuracy?: number } | null> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) {
        toast.error("This device has no GPS / location support");
        resolve(null);
        return;
      }
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false);
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          setMyLoc(loc);
          resolve(loc);
        },
        (err) => {
          setLocating(false);
          toast.error(
            err.code === err.PERMISSION_DENIED
              ? "Location permission denied — allow it in the browser settings"
              : "Could not get your location"
          );
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
    });

  const goToMyLocation = async () => {
    const loc = await locate();
    if (loc) setFocus({ lat: loc.lat, lng: loc.lng });
  };

  const addPointHere = async () => {
    const loc = await locate();
    if (!loc) return;
    const label = window.prompt("Label for this point:", `Point ${track.markers.length + 1}`);
    if (label === null) return;
    onChange({
      markers: [
        ...track.markers,
        { lat: loc.lat, lng: loc.lng, label: label.trim() || `Point ${track.markers.length + 1}`, type: "point" },
      ],
    });
    setFocus({ lat: loc.lat, lng: loc.lng });
  };

  const setAreaToView = () => {
    if (!viewRef.current) return;
    onChange({ center: viewRef.current.center, zoom: viewRef.current.zoom });
    toast.info("Map area set to current view");
  };

  const done = () => {
    setEditing(false);
    setMode("none");
    setCatMenu(false);
  };

  const confirmDelete = () => {
    if (window.confirm(`Delete map "${track.title || "Untitled"}"?`)) onDelete();
  };

  return (
    <section className={styles.card}>
      {/* ── Top: name ── */}
      {editing ? (
        <div className={styles.cardEditHead}>
          <input
            className={styles.titleInput}
            dir="auto"
            placeholder="Map name (e.g. Elite)"
            value={track.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
          <input
            className={styles.headerInput}
            dir="auto"
            placeholder="Header / description (e.g. 3 laps · 4.2 km)"
            value={track.header ?? ""}
            onChange={(e) => onChange({ header: e.target.value })}
          />
          <div className={styles.menuWrap}>
            <button className={styles.btn} onClick={() => setCatMenu((v) => !v)}>
              Categories ({keys.length})
            </button>
            {catMenu && (
              <>
                <div className={styles.backdrop} onClick={() => setCatMenu(false)} />
                <div className={`${styles.menu} ${styles.menuRight} ${styles.catMenu}`}>
                  {waveGroups.length === 0 && (
                    <div className={styles.menuEmpty}>No categories yet — import riders first.</div>
                  )}
                  {waveGroups.map((g) => (
                    <div key={g.waveNum}>
                      <div className={styles.menuGroup}>Wave {g.waveNum}</div>
                      {g.cats.map((cat) => {
                        const key = catWaveKey(cat.name, cat.subCategory);
                        return (
                          <label key={cat.id} className={styles.catCheck}>
                            <input type="checkbox" checked={keys.includes(key)} onChange={() => toggleCategory(key)} />
                            <span className={styles.dot} style={{ background: cat.color ?? "#ccc" }} />
                            <span dir="auto">{cat.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.cardHead}>
          <span className={styles.dot} style={{ background: track.color }} />
          <div className={styles.cardTitleBlock}>
            <div className={styles.cardTitle} dir="auto">{track.title || "Untitled"}</div>
            {(track.header || ridingNames.length > 0) && (
              <div className={styles.cardSub} dir="auto">
                {track.header}
                {track.header && ridingNames.length > 0 && " · "}
                {ridingNames.length > 0 && <>Rides: {ridingNames.join(", ")}</>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Edit tools (only while editing) ── */}
      {editing && (
        <div className={styles.editTools}>
          <button className={styles.btn} onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> {track.points.length > 0 ? "Replace track" : "Upload track"}
          </button>
          <button
            className={`${styles.btn} ${mode === "draw" ? styles.btnActive : ""}`}
            onClick={() => setMode(mode === "draw" ? "none" : "draw")}
            title="Click the map to add route points in order"
          >
            <Route size={14} /> Draw
          </button>
          <button
            className={`${styles.btn} ${mode === "point" ? styles.btnActive : ""}`}
            onClick={() => setMode(mode === "point" ? "none" : "point")}
          >
            <MapPin size={14} /> Point
          </button>
          <button className={styles.btn} onClick={addPointHere} disabled={locating}>
            <LocateFixed size={14} /> Point here
          </button>
          <button className={styles.btn} onClick={goToMyLocation} disabled={locating}>
            <LocateFixed size={14} /> {locating ? "Locating…" : "My location"}
          </button>
          {track.points.length > 0 && (
            <>
              <button className={styles.btn} onClick={() => onChange({ points: track.points.slice(0, -1) })}>
                <Undo2 size={14} /> Undo
              </button>
              <button
                className={styles.btn}
                onClick={() => onChange({ points: [...track.points].reverse() })}
                title="Swap start and finish — arrows flip"
              >
                <ArrowLeftRight size={14} /> Reverse
              </button>
              <button className={styles.btn} onClick={() => onChange({ points: [] })}>
                <Trash2 size={14} /> Clear route
              </button>
            </>
          )}
          {track.markers.length > 0 && (
            <button className={styles.btn} onClick={() => onChange({ markers: [] })}>
              <Trash2 size={14} /> Clear points
            </button>
          )}
          <button className={styles.btn} onClick={setAreaToView}>
            <Crosshair size={14} /> Set area
          </button>
        </div>
      )}

      {/* ── Map ── */}
      <div className={styles.mapBox}>
        <RaceMap
          key={track.id}
          bare
          editable={editing && mode !== "none"}
          center={focus ?? track.center}
          zoom={focus ? 17 : track.zoom}
          trackPoints={track.points}
          markers={track.markers}
          trackColor={track.color}
          myLocation={myLoc}
          location={location}
          onMapClick={handleMapClick}
          onViewChange={(c, z) => {
            viewRef.current = { center: c, zoom: z };
          }}
        />
      </div>

      {editing && track.markers.length > 0 && (
        <div className={styles.markerList}>
          {track.markers.map((m, i) => (
            <div key={i} className={styles.markerRow}>
              <MapPin size={14} className={styles.markerIcon} />
              <span className={styles.markerLabel} dir="auto">{m.label}</span>
              <span className={styles.markerCoords}>
                {m.lat.toFixed(5)}, {m.lng.toFixed(5)}
              </span>
              <button
                className={styles.markerRemove}
                onClick={() => onChange({ markers: track.markers.filter((_, j) => j !== i) })}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Under the map: Edit · Update · Delete ── */}
      <div className={styles.cardActions}>
        {editing ? (
          <button className={styles.btnPrimary} onClick={done}>
            <Check size={14} /> Done
          </button>
        ) : (
          <>
            <button className={styles.btn} onClick={() => setEditing(true)}>
              <Pencil size={14} /> Edit
            </button>
            <button className={styles.btn} onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> Update
            </button>
          </>
        )}
        <button className={styles.btnDanger} onClick={confirmDelete}>
          <Trash2 size={14} /> Delete
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".gpx,.tcx,.xml,.json,.geojson"
        style={{ display: "none" }}
        onChange={handleFile}
      />
    </section>
  );
};

export default MapCard;
