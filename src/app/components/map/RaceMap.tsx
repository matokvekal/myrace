import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { TrackMarker } from '@/types/types';
import styles from './raceMap.module.css';

interface RaceMapProps {
  /** Preferred map center. Falls back to track center, then default. */
  center?: { lat: number; lng: number };
  zoom?: number;
  /** Course polyline as [lat, lng] pairs. */
  trackPoints?: [number, number][];
  /** Named waypoints to drop on the map. */
  markers?: TrackMarker[];
  location?: string;
  title?: string;
  /** When true the map fills its container without the card chrome. */
  bare?: boolean;
  /** When true, clicking the map calls onMapClick (add-point mode). */
  editable?: boolean;
  onMapClick?: (lat: number, lng: number) => void;
  /** Fired (debounced) whenever the user pans/zooms — used to capture the race area. */
  onViewChange?: (center: { lat: number; lng: number }, zoom: number) => void;
}

const DEFAULT_CENTER = { lat: 48.2107, lng: 8.9905 }; // Albstadt, Germany
const DEFAULT_ZOOM = 14;

const MARKER_COLORS: Record<string, string> = {
  start: '#22c55e',
  finish: '#ef4444',
  feed: '#f59e0b',
  point: '#3b82f6',
};

function circle(latlng: L.LatLngExpression, color: string, label: string): L.CircleMarker {
  return L.circleMarker(latlng, {
    radius: 8,
    color: '#fff',
    weight: 2,
    fillColor: color,
    fillOpacity: 1,
  }).bindPopup(label);
}

const RaceMap: React.FC<RaceMapProps> = ({
  center,
  zoom,
  trackPoints,
  markers,
  location,
  title = 'Race Location',
  bare = false,
  editable = false,
  onMapClick,
  onViewChange,
}) => {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const trackLayerRef = useRef<L.LayerGroup | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);

  // Keep latest callbacks without re-initialising the map.
  const clickRef = useRef(onMapClick);
  const viewRef = useRef(onViewChange);
  const editableRef = useRef(editable);
  clickRef.current = onMapClick;
  viewRef.current = onViewChange;
  editableRef.current = editable;

  // ── Init map once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const start = center ?? DEFAULT_CENTER;
    const map = L.map(containerRef.current).setView([start.lat, start.lng], zoom ?? DEFAULT_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    trackLayerRef.current = L.layerGroup().addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (editableRef.current) clickRef.current?.(e.latlng.lat, e.latlng.lng);
    });
    map.on('moveend', () => {
      const c = map.getCenter();
      viewRef.current?.({ lat: c.lat, lng: c.lng }, map.getZoom());
    });

    // Leaflet mis-measures inside flex/tab containers until a resize tick.
    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render track polyline + start/finish ─────────────────────────────────────
  useEffect(() => {
    const layer = trackLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    if (trackPoints && trackPoints.length > 0) {
      const latlngs = trackPoints.map(([la, ln]) => L.latLng(la, ln));
      L.polyline(latlngs, { color: '#3b82f6', weight: 4, opacity: 0.85 }).addTo(layer);
      circle(latlngs[0], MARKER_COLORS.start, 'Start').addTo(layer);
      if (latlngs.length > 1) {
        circle(latlngs[latlngs.length - 1], MARKER_COLORS.finish, 'Finish').addTo(layer);
      }
    }
  }, [trackPoints]);

  // ── Render custom markers ────────────────────────────────────────────────────
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    (markers ?? []).forEach((m) => {
      circle([m.lat, m.lng], MARKER_COLORS[m.type ?? 'point'] ?? MARKER_COLORS.point, m.label).addTo(layer);
    });

    // If there's no track and no explicit center, drop a location pin.
    if ((!trackPoints || trackPoints.length === 0) && (!markers || markers.length === 0) && location && !editable) {
      const c = center ?? DEFAULT_CENTER;
      circle([c.lat, c.lng], MARKER_COLORS.point, location).addTo(layer);
    }
  }, [markers, trackPoints, location, center, editable]);

  // ── Apply center / zoom when they change ─────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (center) {
      map.setView([center.lat, center.lng], zoom ?? map.getZoom());
    } else if (trackPoints && trackPoints.length > 1) {
      map.fitBounds(L.latLngBounds(trackPoints.map(([la, ln]) => L.latLng(la, ln))), { padding: [24, 24] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.lat, center?.lng, zoom]);

  const mapEl = <div className={styles.mapContainer} ref={containerRef} />;

  if (bare) return mapEl;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h4>{title}</h4>
        {location && <p className={styles.location}>{location}</p>}
      </div>
      {mapEl}
    </div>
  );
};

export default RaceMap;
