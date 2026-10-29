import React, { useRef, useState } from "react";
import RaceMap from "@/components/map/RaceMap";
import { parseTrackFile, centerOfPoints } from "@/utils/parseTrack";
import { catWaveKey } from "../schedule/Schedule";
import type { CategoryProps, RaceTrack } from "@/types/types";
import { toast } from "react-toastify";
import { MoreHorizontal, Route, Trash2, Upload } from "lucide-react";
import styles from "./map.module.css";

/** View-only fallback for a map with nothing saved yet (no centre, route or points).
 *  Never written to the race. */
const FALLBACK_CENTER = { lat: 40.7829, lng: -73.9654 }; // Central Park, New York
const FALLBACK_ZOOM = 15;

interface MapCardProps {
  /** Position in the race's map list: the card is shown as "Map {index + 1}". */
  index: number;
  track: RaceTrack;
  categories: CategoryProps[];
  location?: string;
  onChange: (patch: Partial<RaceTrack>) => void;
  onDelete: () => void;
  /** Opens the full-screen route drawing. */
  onDraw: () => void;
}

/**
 * One course map: name and description, a preview, and Draw route. Uploading a
 * track file and deleting sit in the ⋯ menu. Drawing happens in DrawRoute.
 */
const MapCard: React.FC<MapCardProps> = ({ index, track, categories, location, onChange, onDelete, onDraw }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [moreMenu, setMoreMenu] = useState(false);
  const mapName = `Map ${index + 1}`;

  const keys = track.categoryKeys ?? [];
  const ridingNames = categories
    .filter((c) => keys.includes(catWaveKey(c.name, c.subCategory)))
    .map((c) => c.name);

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
        // An uploaded track replaces a drawn route.
        waypoints: [],
        ...(c ? { center: c, zoom: 15 } : {}),
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

  const confirmDelete = () => {
    if (window.confirm(`Delete ${mapName}${track.header ? ` (${track.header})` : ""}?`)) onDelete();
  };

  const hasSavedView = !!track.center || track.points.length > 0 || track.markers.length > 0;

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.dot} style={{ background: track.color }} />
        <span className={styles.fixedName}>{mapName}</span>
        <input
          className={styles.headerInput}
          dir="auto"
          aria-label={`${mapName} description`}
          placeholder="Description"
          value={track.header ?? ""}
          onChange={(e) => onChange({ header: e.target.value })}
        />
        <div className={styles.menuWrap}>
          <button className={styles.tool} onClick={() => setMoreMenu((v) => !v)} aria-expanded={moreMenu} aria-label="More map actions" title="More">
            <MoreHorizontal size={16} />
          </button>
          {moreMenu && (
            <>
              <div className={styles.backdrop} onClick={() => setMoreMenu(false)} />
              <div className={`${styles.menu} ${styles.menuRight}`} role="menu">
                <button className={styles.menuItem} role="menuitem" onClick={() => { setMoreMenu(false); fileRef.current?.click(); }}>
                  <Upload size={14} /> Upload track file
                </button>
                <button className={`${styles.menuItem} ${styles.menuDanger}`} role="menuitem" onClick={() => { setMoreMenu(false); confirmDelete(); }}>
                  <Trash2 size={14} /> Delete map
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {ridingNames.length > 0 && <div className={styles.cardSub} dir="auto">Rides: {ridingNames.join(", ")}</div>}

      <div className={styles.mapBox}>
        <RaceMap
          key={`${track.id}-${track.points.length}-${track.center?.lat ?? ""}`}
          bare
          center={track.center ?? (hasSavedView ? undefined : FALLBACK_CENTER)}
          zoom={track.zoom ?? (hasSavedView ? undefined : FALLBACK_ZOOM)}
          trackPoints={track.points}
          markers={track.markers}
          trackColor={track.color}
          location={hasSavedView ? location : undefined}
        />
      </div>

      <button className={styles.btnPrimary} onClick={onDraw} data-testid="draw-route">
        <Route size={15} /> {track.points.length > 1 ? "Edit route" : "Draw route"}
      </button>

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
