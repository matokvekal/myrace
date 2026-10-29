import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowLeft, ListOrdered, Undo2 } from "lucide-react";
import type { RaceTrack, TrackMarker, TrackWaypoint } from "@/types/types";
import { bearingDeg } from "@/utils/raceTracks";
import { routeSegment, type RouteMode } from "@/utils/routeSnap";
import styles from "./drawRoute.module.css";

const FALLBACK_CENTER = { lat: 40.7829, lng: -73.9654 }; // Central Park, New York

interface Props {
  /** Shown as "Map {index + 1}". */
  index: number;
  track: RaceTrack;
  onChange: (patch: Partial<RaceTrack>) => void;
  onClose: () => void;
}

/** A label also marks the point on the map (Start / Finish keep their marker type). */
const markerType = (label: string): TrackMarker["type"] => {
  const l = label.trim().toLowerCase();
  if (l === "start") return "start";
  if (l === "finish") return "finish";
  if (/water|feed|מים|האכלה/.test(l)) return "feed";
  return "point";
};

/**
 * Full-screen route drawing. Tap adds a point (first = green start arrow,
 * others red); drag a point to move it; Undo reverts the last action; 🚗 / 🚴
 * choose road or cycling routing between points. Saves as you go: the routed
 * line into `points`, named points into `markers`, the tapped points into
 * `waypoints`. Pattern from El Niño's Route Builder.
 */
const DrawRoute: React.FC<Props> = ({ index, track, onChange, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  // What the map had when opened — restored if every drawn point is undone.
  const originalRef = useRef({ points: track.points, markers: track.markers });

  const [waypoints, setWaypoints] = useState<TrackWaypoint[]>(track.waypoints ?? []);
  const [mode, setMode] = useState<RouteMode>(track.routeMode ?? "bike");
  const [history, setHistory] = useState<TrackWaypoint[][]>([]);
  const [segments, setSegments] = useState<{ points: [number, number][]; routed: boolean }[]>([]);
  const [routing, setRouting] = useState((track.waypoints?.length ?? 0) >= 2);
  const [listOpen, setListOpen] = useState(false);

  const commit = (next: TrackWaypoint[]) => {
    setHistory((h) => [...h.slice(-49), waypoints]);
    setWaypoints(next);
  };
  const undo = () => {
    if (!history.length) return;
    setWaypoints(history[history.length - 1]);
    setHistory(history.slice(0, -1));
  };

  // Map setup (once)
  useEffect(() => {
    if (!containerRef.current) return;
    const first = track.waypoints?.[0];
    const start = track.center ?? (first ? { lat: first.lat, lng: first.lng } : FALLBACK_CENTER);
    const map = L.map(containerRef.current, { zoomControl: false }).setView(
      [start.lat, start.lng],
      track.zoom ?? 15
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    if (!track.center && track.points.length > 1) map.fitBounds(L.latLngBounds(track.points), { padding: [30, 30] });
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tap adds a point (re-bound so it sees the latest waypoints)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: L.LeafletMouseEvent) => commit([...waypoints, { lat: e.latlng.lat, lng: e.latlng.lng }]);
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypoints]);

  // Route every segment (cached), then save
  useEffect(() => {
    let alive = true;
    if (waypoints.length < 2) {
      setSegments([]);
      setRouting(false);
    } else {
      setRouting(true);
      void Promise.all(
        waypoints.slice(1).map((w, i) => routeSegment(waypoints[i], w, mode))
      ).then((segs) => {
        if (!alive) return;
        setSegments(segs);
        setRouting(false);
      });
    }
    return () => {
      alive = false;
    };
  }, [waypoints, mode]);

  // Persist the drawn route (or restore the original when nothing is drawn)
  useEffect(() => {
    if (routing) return;
    // Save only once the routed segments match the points (never a half-routed line).
    if (waypoints.length >= 2 && segments.length !== waypoints.length - 1) return;
    if (waypoints.length === 0) {
      onChange({ waypoints: [], routeMode: mode, ...originalRef.current });
      return;
    }
    const line: [number, number][] = waypoints.length === 1 ? [[waypoints[0].lat, waypoints[0].lng]] : [];
    segments.forEach((s, i) => line.push(...(i === 0 ? s.points : s.points.slice(1))));
    const markers: TrackMarker[] = waypoints
      .filter((w) => w.label?.trim())
      .map((w) => ({ lat: w.lat, lng: w.lng, label: w.label!.trim(), type: markerType(w.label!) }));
    onChange({ waypoints, routeMode: mode, points: line, markers });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, routing, waypoints, mode]);

  // Draw route + points
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (waypoints.length === 0 && originalRef.current.points.length > 1) {
      // Existing (uploaded) route, faded: tapping starts a new drawn route.
      L.polyline(originalRef.current.points, { color: track.color, weight: 4, opacity: 0.35 }).addTo(layer);
    }
    const line: [number, number][] = [];
    segments.forEach((s, i) => line.push(...(i === 0 ? s.points : s.points.slice(1))));
    if (line.length > 1) L.polyline(line, { color: track.color, weight: 5, opacity: 0.9 }).addTo(layer);

    waypoints.forEach((w, i) => {
      let icon: L.DivIcon;
      if (i === 0) {
        const next = segments[0]?.points[1] ?? (waypoints[1] ? [waypoints[1].lat, waypoints[1].lng] : null);
        const deg = next ? bearingDeg([w.lat, w.lng], next as [number, number]) : 90;
        icon = L.divIcon({
          className: "",
          html: `<div class="${styles.startPin}" style="transform:rotate(${deg - 90}deg)">➤</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        });
      } else {
        icon = L.divIcon({ className: "", html: `<div class="${styles.pointPin}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
      }
      const m = L.marker([w.lat, w.lng], { icon, draggable: true, autoPan: true }).addTo(layer);
      if (w.label?.trim()) m.bindTooltip(w.label.trim(), { permanent: true, direction: "top", offset: [0, -10] });
      // Clicking a point must not add another one.
      m.on("click", (e) => L.DomEvent.stopPropagation(e));
      m.on("dragend", () => {
        const p = m.getLatLng();
        commit(waypoints.map((x, j) => (j === i ? { ...x, lat: p.lat, lng: p.lng } : x)));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, waypoints]);

  const close = () => {
    const map = mapRef.current;
    if (map) {
      const c = map.getCenter();
      onChange({ center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() });
    }
    onClose();
  };

  const anyStraight = segments.some((s) => !s.routed);

  return (
    <div className={styles.screen} role="dialog" aria-label={`Draw route: Map ${index + 1}`}>
      <div className={styles.bar}>
        <button type="button" className={styles.iconBtn} onClick={close} aria-label="Back" title="Back">
          <ArrowLeft size={20} />
        </button>
        <span className={styles.title} dir="auto">
          Map {index + 1}
          {track.header ? <span className={styles.sub}> · {track.header}</span> : null}
        </span>
        <div className={styles.modes} role="group" aria-label="Routing">
          <button
            type="button"
            className={`${styles.modeBtn} ${mode === "car" ? styles.modeOn : ""}`}
            aria-pressed={mode === "car"}
            onClick={() => setMode("car")}
            title="Car: follow roads"
            aria-label="Car: follow roads"
          >🚗</button>
          <button
            type="button"
            className={`${styles.modeBtn} ${mode === "bike" ? styles.modeOn : ""}`}
            aria-pressed={mode === "bike"}
            onClick={() => setMode("bike")}
            title="Bicycle: cycling paths and trails"
            aria-label="Bicycle: cycling paths and trails"
          >🚴</button>
        </div>
        <button
          type="button"
          className={`${styles.iconBtn} ${listOpen ? styles.iconBtnOn : ""}`}
          onClick={() => setListOpen((o) => !o)}
          aria-expanded={listOpen}
          aria-label="Route points"
          title="Route points"
        >
          <ListOrdered size={20} />
        </button>
        <button type="button" className={styles.iconBtn} onClick={undo} disabled={!history.length} aria-label="Undo" title="Undo">
          <Undo2 size={20} />
        </button>
      </div>

      <div ref={containerRef} className={styles.map} />

      {(waypoints.length === 0 || routing || anyStraight) && (
        <div className={styles.hint} role="status">
          {waypoints.length === 0
            ? "Tap the map to start the route"
            : routing
              ? "Routing…"
              : "Some parts are straight lines (no route found)"}
        </div>
      )}

      {listOpen && (
        <div className={styles.list}>
          {waypoints.length === 0 && <div className={styles.empty}>No points yet.</div>}
          {waypoints.map((w, i) => (
            <label key={i} className={styles.row}>
              <span className={`${styles.num} ${i === 0 ? styles.numStart : ""}`}>{i + 1}</span>
              <input
                className={styles.name}
                dir="auto"
                placeholder={i === 0 ? "Start" : i === waypoints.length - 1 ? "Finish" : "Name (optional)"}
                value={w.label ?? ""}
                onChange={(e) => setWaypoints(waypoints.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export default DrawRoute;
