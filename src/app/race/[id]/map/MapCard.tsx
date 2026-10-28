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
  MoreHorizontal,
} from "lucide-react";
import styles from "./map.module.css";

/** View-only fallback for a map with nothing saved yet (no centre, route or points).
 *  Never written to the race — only "Set area" saves a view. */
const FALLBACK_CENTER = { lat: 40.7829, lng: -73.9654 }; // Central Park, New York
const FALLBACK_ZOOM = 15;

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
  const [moreMenu, setMoreMenu] = useState(false);
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

  // Anything the race already has for this map wins over the Central Park fallback.
  const hasSavedView = !!track.center || track.points.length > 0 || track.markers.length > 0;

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

      {/* ── Toolbar: route · points · view · More, then Done / Edit ── */}
      <div className={styles.toolbar}>
        {editing ? (
          <>
            <div className={styles.toolGroup} role="group" aria-label="Route">
              <button className={styles.tool} onClick={() => fileRef.current?.click()} title={track.points.length > 0 ? "Replace track file (GPX, TCX, GeoJSON)" : "Upload a track file (GPX, TCX, GeoJSON)"}>
                <Upload size={15} /> <span>{track.points.length > 0 ? "Replace" : "Upload"}</span>
              </button>
              <button
                className={`${styles.tool} ${mode === "draw" ? styles.toolActive : ""}`}
                aria-pressed={mode === "draw"}
                onClick={() => setMode(mode === "draw" ? "none" : "draw")}
                title="Draw: click the map to add route points in order"
              >
                <Route size={15} /> <span>Draw</span>
              </button>
              <button className={styles.tool} onClick={() => onChange({ points: track.points.slice(0, -1) })} disabled={track.points.length === 0} title="Undo last route point" aria-label="Undo last route point">
                <Undo2 size={15} />
              </button>
              <button className={styles.tool} onClick={() => onChange({ points: [...track.points].reverse() })} disabled={track.points.length === 0} title="Reverse: swap start and finish" aria-label="Reverse route">
                <ArrowLeftRight size={15} />
              </button>
            </div>
            <div className={styles.toolGroup} role="group" aria-label="Points">
              <button
                className={`${styles.tool} ${mode === "point" ? styles.toolActive : ""}`}
                aria-pressed={mode === "point"}
                onClick={() => setMode(mode === "point" ? "none" : "point")}
                title="Point: click the map to drop a labelled point"
              >
                <MapPin size={15} /> <span>Point</span>
              </button>
              <button className={styles.tool} onClick={addPointHere} disabled={locating} title="Add a point at my current location" aria-label="Point here">
                <MapPin size={15} /> <LocateFixed size={12} />
              </button>
            </div>
            <div className={styles.toolGroup} role="group" aria-label="View">
              <button className={styles.tool} onClick={goToMyLocation} disabled={locating} title={locating ? "Locating…" : "Go to my location"} aria-label="My location">
                <LocateFixed size={15} />
              </button>
              <button className={styles.tool} onClick={setAreaToView} title="Set area: save the current view as this map's area" aria-label="Set area">
                <Crosshair size={15} />
              </button>
            </div>
          </>
        ) : (
          <button className={styles.tool} onClick={() => setEditing(true)} title="Edit this map">
            <Pencil size={15} /> <span>Edit</span>
          </button>
        )}

        <div className={styles.toolbarEnd}>
          <div className={styles.menuWrap}>
            <button className={styles.tool} onClick={() => setMoreMenu((v) => !v)} aria-expanded={moreMenu} title="More" aria-label="More map actions">
              <MoreHorizontal size={16} />
            </button>
            {moreMenu && (
              <>
                <div className={styles.backdrop} onClick={() => setMoreMenu(false)} />
                <div className={`${styles.menu} ${styles.menuRight}`} role="menu">
                  {!editing && (
                    <button className={styles.menuItem} role="menuitem" onClick={() => { setMoreMenu(false); fileRef.current?.click(); }}>
                      <Upload size={14} /> Update track file
                    </button>
                  )}
                  {editing && track.points.length > 0 && (
                    <button className={styles.menuItem} role="menuitem" onClick={() => { setMoreMenu(false); onChange({ points: [] }); }}>
                      <Trash2 size={14} /> Clear route
                    </button>
                  )}
                  {editing && track.markers.length > 0 && (
                    <button className={styles.menuItem} role="menuitem" onClick={() => { setMoreMenu(false); onChange({ markers: [] }); }}>
                      <Trash2 size={14} /> Clear points
                    </button>
                  )}
                  <button className={`${styles.menuItem} ${styles.menuDanger}`} role="menuitem" onClick={() => { setMoreMenu(false); confirmDelete(); }}>
                    <Trash2 size={14} /> Delete map
                  </button>
                </div>
              </>
            )}
          </div>
          {editing && (
            <button className={styles.btnPrimary} onClick={done}>
              <Check size={14} /> Done
            </button>
          )}
        </div>
      </div>

      {/* ── Map ── */}
      <div className={styles.mapBox}>
        <RaceMap
          key={track.id}
          bare
          editable={editing && mode !== "none"}
          center={focus ?? track.center ?? (hasSavedView ? undefined : FALLBACK_CENTER)}
          zoom={focus ? 17 : track.zoom ?? (hasSavedView ? undefined : FALLBACK_ZOOM)}
          trackPoints={track.points}
          markers={track.markers}
          trackColor={track.color}
          myLocation={myLoc}
          location={hasSavedView ? location : undefined}
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
