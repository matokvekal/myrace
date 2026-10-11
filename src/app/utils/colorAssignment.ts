import { COLORS } from "@/constants/index";

/**
 * Category colour assignment.
 *
 * Colours used to come straight off `COLORS[index % length]` in whatever order
 * categories happened to be created. The palette has several near-identical
 * neighbours (Steel Blue / Dodger Blue / Royal Blue / Cornflower Blue…), so two
 * starts a few minutes apart routinely ended up looking the same on the live
 * board — exactly when a commissaire most needs to tell them apart (BUGS.md #6).
 *
 * Assignment here is start-time aware: a category only has to look distinct from
 * the ones starting NEAR it. Colours are free to repeat across the day.
 */

/**
 * Starts within this many minutes must not share a similar colour.
 *
 * Sized to the real schedule, not to the gap between starts: waves go off ~10
 * minutes apart and a race runs anywhere from 15 minutes to 1.5 hours, so waves
 * starting up to ~90 minutes apart can still be ON COURSE together — which is
 * precisely when two look-alike colours cause a mis-tap. Anything that can
 * overlap on track must look different.
 *
 * The palette holds 40+ colours and a 90-minute window covers roughly 9 waves,
 * so this is comfortably satisfiable; colours still recycle later in the day.
 */
export const CLOSE_START_MINUTES = 90;

/** Below this CIE76 ΔE two colours read as "the same" at a glance on a phone. */
const MIN_PERCEPTUAL_DISTANCE = 40;

type Lab = { L: number; a: number; b: number };

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().replace(/^#/, "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ];
}

/** sRGB → CIE L*a*b* (D65). Lab is roughly perceptually uniform, so plain
 *  euclidean distance in it approximates "how different do these look". */
function rgbToLab([r, g, b]: [number, number, number]): Lab {
  const toLinear = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];

  // linear sRGB → XYZ
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = (lr * 0.2126 + lg * 0.7152 + lb * 0.0722) / 1.0;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const labCache = new Map<string, Lab | null>();
function labOf(hex: string): Lab | null {
  if (!labCache.has(hex)) {
    const rgb = hexToRgb(hex);
    labCache.set(hex, rgb ? rgbToLab(rgb) : null);
  }
  return labCache.get(hex) ?? null;
}

/** Perceptual distance between two hex colours (CIE76 ΔE). */
export function colorDistance(hexA: string, hexB: string): number {
  const a = labOf(hexA);
  const b = labOf(hexB);
  if (!a || !b) return Infinity; // unparseable: never treat as a clash
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

/** True when two colours are too alike to tell apart at a glance. */
export function colorsAreSimilar(hexA: string, hexB: string): boolean {
  return colorDistance(hexA, hexB) < MIN_PERCEPTUAL_DISTANCE;
}

/** "HH:MM" → minutes since midnight. Null when unparseable. */
export function startMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Pick the palette colour that stands out most from `avoid`.
 *
 * Maximises the distance to the NEAREST colour being avoided, so the winner is
 * the one least likely to be confused with any of them. `usageCount` breaks ties
 * toward colours used less often overall, keeping the whole race varied.
 */
export function pickDistinctColor(
  avoid: string[],
  usageCount: Map<string, number> = new Map(),
  palette: string[] = COLORS.map((c) => c.code)
): string {
  let best = palette[0];
  let bestScore = -Infinity;

  for (const candidate of palette) {
    const nearest = avoid.length
      ? Math.min(...avoid.map((other) => colorDistance(candidate, other)))
      : Infinity;
    // Cap the reward: once a colour is clearly distinct, extra distance shouldn't
    // outweigh spreading usage around the palette.
    const distanceScore = Math.min(nearest, MIN_PERCEPTUAL_DISTANCE * 2);
    const score = distanceScore * 1000 - (usageCount.get(candidate) ?? 0);

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

export interface ColorAssignable {
  name: string;
  subCategory?: string | null;
  startTime: string | null;
  color?: string | null;
}

/**
 * Assign a colour to every category, keeping starts that go off close together
 * visually distinct. Returns hex codes keyed by `name::subCategory`.
 *
 * Categories are processed in start-time order (undated ones last) so each only
 * has to avoid the ones already placed near it in time.
 */
export function assignCategoryColors<T extends ColorAssignable>(
  categories: T[]
): Map<string, string> {
  const keyOf = (c: ColorAssignable) => `${c.name}::${c.subCategory ?? ""}`;

  const ordered = [...categories].sort((a, b) => {
    const am = startMinutes(a.startTime);
    const bm = startMinutes(b.startTime);
    if (am === null && bm === null) return 0;
    if (am === null) return 1; // no start time → assign last
    if (bm === null) return -1;
    return am - bm;
  });

  const assigned = new Map<string, string>();
  const placed: Array<{ minutes: number | null; color: string }> = [];
  const usage = new Map<string, number>();

  for (const cat of ordered) {
    const minutes = startMinutes(cat.startTime);

    // Only clash-check against starts close in time. A category with no start
    // time can't be compared, so keep it distinct from everything placed so far.
    const avoid = placed
      .filter((p) => {
        if (minutes === null || p.minutes === null) return true;
        return Math.abs(p.minutes - minutes) <= CLOSE_START_MINUTES;
      })
      .map((p) => p.color);

    const color = pickDistinctColor(avoid, usage);
    assigned.set(keyOf(cat), color);
    placed.push({ minutes, color });
    usage.set(color, (usage.get(color) ?? 0) + 1);
  }

  return assigned;
}
