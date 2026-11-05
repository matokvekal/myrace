import type { RaceProps, RaceTrack } from "@/types/types";

export const TRACK_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#14b8a6"];

export function newTrack(index: number, title?: string): RaceTrack {
  return {
    id: `trk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: title ?? `Map ${index + 1}`,
    header: "",
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    points: [],
    markers: [],
  };
}

/**
 * The race's maps. Races saved before multi-map support only have the single
 * trackPoints/mapMarkers/mapCenter — surface those as one map so nothing is lost.
 */
export function getRaceTracks(race: RaceProps | undefined): RaceTrack[] {
  if (!race) return [];
  if (race.tracks) return race.tracks;
  const hasLegacy =
    (race.trackPoints?.length ?? 0) > 0 || (race.mapMarkers?.length ?? 0) > 0 || !!race.mapCenter;
  if (!hasLegacy) return [];
  return [
    {
      ...newTrack(0, "Course"),
      id: "trk-legacy",
      points: race.trackPoints ?? [],
      markers: race.mapMarkers ?? [],
      center: race.mapCenter,
      zoom: race.mapZoom,
    },
  ];
}

// ── Direction arrows ──────────────────────────────────────────────────────────

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

function distanceM(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Compass bearing a→b in degrees (0 = north, clockwise). */
export function bearingDeg(a: [number, number], b: [number, number]): number {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x =
    Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
    Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export interface DirectionArrow {
  at: [number, number];
  bearing: number;
}

/**
 * Evenly spaced arrows along the route, pointing in the order the points were
 * given (start → finish). Spacing scales with the route length so a short kids'
 * loop and a long elite lap both get a readable number of arrows.
 */
export function directionArrows(points: [number, number][], target = 10): DirectionArrow[] {
  if (points.length < 2) return [];
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1], points[i]);
  if (total === 0) return [];

  const step = Math.min(800, Math.max(60, total / target));
  const arrows: DirectionArrow[] = [];
  let next = step / 2;
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = distanceM(a, b);
    if (seg === 0) continue;
    while (next <= walked + seg) {
      const t = (next - walked) / seg;
      arrows.push({
        at: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        bearing: bearingDeg(a, b),
      });
      next += step;
    }
    walked += seg;
  }
  return arrows;
}
