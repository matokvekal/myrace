/**
 * Route one segment between two tapped points along real ways, with BRouter
 * (open source, OpenStreetMap data; the same engine El Niño's Route Builder
 * uses), on the free public instance. "car" follows roads, "bike" prefers
 * cycling paths and trails. Any failure (offline, no route) falls back to a
 * straight line so drawing never blocks.
 */
export type RouteMode = "car" | "bike";
type LL = { lat: number; lng: number };

const BROUTER_URL = "https://brouter.de/brouter";
const PROFILE: Record<RouteMode, string> = { car: "car-fast", bike: "trekking" };
const TIMEOUT_MS = 10_000;

const cache = new Map<string, { points: [number, number][]; routed: boolean }>();
const c6 = (n: number) => n.toFixed(6);

export async function routeSegment(
  a: LL,
  b: LL,
  mode: RouteMode
): Promise<{ points: [number, number][]; routed: boolean }> {
  const key = `${mode}|${c6(a.lat)},${c6(a.lng)}|${c6(b.lat)},${c6(b.lng)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const straight = { points: [[a.lat, a.lng], [b.lat, b.lng]] as [number, number][], routed: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const params = new URLSearchParams({
      lonlats: `${c6(a.lng)},${c6(a.lat)}|${c6(b.lng)},${c6(b.lat)}`,
      profile: PROFILE[mode],
      alternativeidx: "0",
      format: "geojson",
    });
    const res = await fetch(`${BROUTER_URL}?${params}`, { signal: ctrl.signal });
    if (!res.ok) return straight; // 400 = no route between these points
    const body = await res.json();
    const coords: unknown = body?.features?.[0]?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return straight;
    const points = coords
      .filter((c): c is number[] => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map((c) => [c[1], c[0]] as [number, number]);
    const out = points.length >= 2 ? { points, routed: true } : straight;
    cache.set(key, out);
    return out;
  } catch {
    return straight;
  } finally {
    clearTimeout(timer);
  }
}
