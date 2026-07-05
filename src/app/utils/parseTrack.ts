import type { TrackMarker } from "@/types/types";

export interface ParsedTrack {
  points: [number, number][];   // route polyline as [lat, lng]
  markers: TrackMarker[];       // named waypoints
}

const isFiniteNum = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

const validLatLng = (lat: number, lng: number): boolean =>
  isFiniteNum(lat) && isFiniteNum(lng) &&
  lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

/**
 * Parse a Garmin/GPS track file into route points + named waypoints.
 * Supports:
 *  - GPX  (<trkpt>, <rtept>, <wpt>)
 *  - TCX  (<Trackpoint><Position><LatitudeDegrees>…)
 *  - JSON — array of [lat, lng] pairs, array of {lat,lng}/{latitude,longitude} objects
 *  - GeoJSON — LineString / MultiLineString / Point features
 */
export function parseTrackFile(fileName: string, text: string): ParsedTrack {
  const name = fileName.toLowerCase();
  const trimmed = text.trim();

  if (name.endsWith(".json") || name.endsWith(".geojson") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJson(trimmed);
  }
  if (name.endsWith(".tcx") || /<TrainingCenterDatabase|<Trackpoint/i.test(trimmed)) {
    return parseTcx(trimmed);
  }
  // default: GPX / generic XML with lat/lon attributes
  return parseGpx(trimmed);
}

// ── GPX ─────────────────────────────────────────────────────────────────────
function parseGpx(text: string): ParsedTrack {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid GPX/XML file");
  }

  const points: [number, number][] = [];
  // Track points and route points form the line
  doc.querySelectorAll("trkpt, rtept").forEach((el) => {
    const lat = parseFloat(el.getAttribute("lat") ?? "");
    const lng = parseFloat(el.getAttribute("lon") ?? "");
    if (validLatLng(lat, lng)) points.push([lat, lng]);
  });

  const markers: TrackMarker[] = [];
  doc.querySelectorAll("wpt").forEach((el) => {
    const lat = parseFloat(el.getAttribute("lat") ?? "");
    const lng = parseFloat(el.getAttribute("lon") ?? "");
    if (validLatLng(lat, lng)) {
      const label = el.querySelector("name")?.textContent?.trim() || "Waypoint";
      markers.push({ lat, lng, label, type: "point" });
    }
  });

  if (points.length === 0 && markers.length === 0) {
    throw new Error("No track points found in GPX file");
  }
  return { points, markers };
}

// ── TCX (Garmin) ──────────────────────────────────────────────────────────────
function parseTcx(text: string): ParsedTrack {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid TCX file");
  }
  const points: [number, number][] = [];
  doc.querySelectorAll("Trackpoint > Position").forEach((pos) => {
    const lat = parseFloat(pos.querySelector("LatitudeDegrees")?.textContent ?? "");
    const lng = parseFloat(pos.querySelector("LongitudeDegrees")?.textContent ?? "");
    if (validLatLng(lat, lng)) points.push([lat, lng]);
  });
  if (points.length === 0) throw new Error("No track points found in TCX file");
  return { points, markers: [] };
}

// ── JSON / GeoJSON ───────────────────────────────────────────────────────────
function parseJson(text: string): ParsedTrack {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON file");
  }

  // GeoJSON
  if (data && typeof data === "object" && "type" in (data as Record<string, unknown>)) {
    const geo = parseGeoJson(data);
    if (geo) return geo;
  }

  // Plain array
  if (Array.isArray(data)) {
    const points = coordArrayToPoints(data);
    if (points.length > 0) return { points, markers: [] };
  }

  // Object wrapper: { points: [...] } / { track: [...] } / { coordinates: [...] }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["points", "track", "coordinates", "route", "path"]) {
      if (Array.isArray(obj[key])) {
        const points = coordArrayToPoints(obj[key] as unknown[]);
        if (points.length > 0) return { points, markers: [] };
      }
    }
  }

  throw new Error("Could not read coordinates from JSON file");
}

function coordArrayToPoints(arr: unknown[]): [number, number][] {
  const points: [number, number][] = [];
  for (const item of arr) {
    if (Array.isArray(item) && item.length >= 2) {
      // [lat, lng]
      const lat = Number(item[0]);
      const lng = Number(item[1]);
      if (validLatLng(lat, lng)) points.push([lat, lng]);
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const lat = Number(o.lat ?? o.latitude ?? o.Lat);
      const lng = Number(o.lng ?? o.lon ?? o.longitude ?? o.Lng ?? o.Lon);
      if (validLatLng(lat, lng)) points.push([lat, lng]);
    }
  }
  return points;
}

function parseGeoJson(data: unknown): ParsedTrack | null {
  const points: [number, number][] = [];
  const markers: TrackMarker[] = [];

  const handleGeometry = (geom: Record<string, unknown>, label?: string) => {
    const type = geom.type;
    const coords = geom.coordinates as unknown;
    if (type === "LineString" && Array.isArray(coords)) {
      pushLonLat(coords as unknown[], points);
    } else if (type === "MultiLineString" && Array.isArray(coords)) {
      (coords as unknown[]).forEach((line) => pushLonLat(line as unknown[], points));
    } else if (type === "Point" && Array.isArray(coords) && coords.length >= 2) {
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (validLatLng(lat, lng)) markers.push({ lat, lng, label: label || "Point", type: "point" });
    }
  };

  const root = data as Record<string, unknown>;
  if (root.type === "FeatureCollection" && Array.isArray(root.features)) {
    (root.features as unknown[]).forEach((f) => {
      const feat = f as Record<string, unknown>;
      const props = (feat.properties as Record<string, unknown>) ?? {};
      const label = (props.name as string) ?? undefined;
      if (feat.geometry) handleGeometry(feat.geometry as Record<string, unknown>, label);
    });
  } else if (root.type === "Feature" && root.geometry) {
    const props = (root.properties as Record<string, unknown>) ?? {};
    handleGeometry(root.geometry as Record<string, unknown>, props.name as string);
  } else if (typeof root.type === "string") {
    handleGeometry(root);
  }

  if (points.length === 0 && markers.length === 0) return null;
  return { points, markers };
}

// GeoJSON coordinates are [lng, lat] — flip to [lat, lng]
function pushLonLat(coords: unknown[], out: [number, number][]) {
  for (const c of coords) {
    if (Array.isArray(c) && c.length >= 2) {
      const lng = Number(c[0]);
      const lat = Number(c[1]);
      if (validLatLng(lat, lng)) out.push([lat, lng]);
    }
  }
}

/** Geometric center of a set of points, for defaulting the map area. */
export function centerOfPoints(points: [number, number][]): { lat: number; lng: number } | null {
  if (points.length === 0) return null;
  let lat = 0, lng = 0;
  for (const [la, ln] of points) { lat += la; lng += ln; }
  return { lat: lat / points.length, lng: lng / points.length };
}
