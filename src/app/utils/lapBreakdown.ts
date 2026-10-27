import type { RiderProps } from "@/types/types";
import { isAdministrativeFinish } from "./waveFinish";

/**
 * Lap-by-lap performance of one rider, from the recorded passages only.
 *
 * - Positions and gaps compare the rider with riders of the SAME category at
 *   the same completed lap (a lapped rider is compared on their own lap k,
 *   never with riders a lap ahead).
 * - Nothing is invented: a missing passage, an unknown start or an unreliable
 *   comparison is `null` (shown as N/A), never estimated.
 * - A recovered passage (entered later, at an estimated time) is used for
 *   counting and ranking but flagged, and the laps it bounds never count as
 *   the fastest lap.
 */

type Lap = RiderProps["lapsDetails"][number] & { recovered?: boolean };
type BreakdownRider = Pick<
  RiderProps,
  "id" | "category" | "subCategory" | "lapsCounter" | "lapsDetails" | "timeStartRace" | "status" | "raceStatus"
>;

export interface LapRow {
  lap: number;
  /** Lap duration (ms), or null when a bounding passage or the start is unknown. */
  durationMs: number | null;
  /** The recorded crossing (epoch ms), or null when the passage is missing. */
  crossingMs: number | null;
  /** Position in the category at this lap, or null when it can't be told reliably. */
  position: number | null;
  /** Behind the category's first rider at this lap (ms; 0 = leading), or null. */
  gapMs: number | null;
  /** The crossing was recovered after the fact (estimated time). */
  recovered: boolean;
}

export type FinalGap = { kind: "leader" } | { kind: "time"; ms: number } | { kind: "laps"; laps: number } | null;

export interface RiderBreakdown {
  rows: LapRow[];
  completedLaps: number;
  /** Start → last recorded crossing (ms), or null. */
  totalMs: number | null;
  /** Final category position among classified riders, or null (out / not ranked). */
  position: number | null;
  finalGap: FinalGap;
  fastestLapMs: number | null;
  fastestLap: number | null;
  averageLapMs: number | null;
  /** Finished administratively: the last lap has no finish-line time. */
  adminFinish: boolean;
}

const OUT = ["DNF", "DSQ", "DNS"];
const toMs = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Lap number → { crossing, recovered }, from the recorded passages (first valid one per lap). */
export function crossingsOf(r: Pick<RiderProps, "lapsDetails">): Map<number, { ms: number; recovered: boolean }> {
  const map = new Map<number, { ms: number; recovered: boolean }>();
  (r.lapsDetails ?? []).forEach((l: Lap, i) => {
    const lap = Number.isInteger(l?.lap) && l.lap > 0 ? l.lap : i + 1;
    const ms = toMs(l?.endTime);
    if (ms != null && !map.has(lap)) map.set(lap, { ms, recovered: !!l.recovered });
  });
  return map;
}

/**
 * The race start for lap 1: the recorded start of lap 1, else the start clock
 * ("HH:MM:SS") on the day of the first crossing. Null when neither is usable.
 */
export function startOf(r: Pick<RiderProps, "lapsDetails" | "timeStartRace">): number | null {
  const details = r.lapsDetails ?? [];
  const lap1 = details.find((l) => l?.lap === 1) ?? (details[0] && !details[0].lap ? details[0] : undefined);
  const recorded = toMs(lap1?.startTime);
  const firstCrossing = toMs(lap1?.endTime) ?? toMs(details[0]?.endTime);
  if (recorded != null && (firstCrossing == null || recorded <= firstCrossing)) return recorded;
  const clock = r.timeStartRace?.trim();
  if (!clock) return null;
  if (clock.includes("T")) return toMs(clock);
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(clock);
  if (!m || firstCrossing == null) return null;
  const d = new Date(firstCrossing);
  d.setHours(Number(m[1]), Number(m[2]), Number(m[3] ?? 0), 0);
  const ms = d.getTime();
  return ms <= firstCrossing ? ms : null;
}

const sameCategory = (a: BreakdownRider, b: BreakdownRider) =>
  a.category === b.category && (a.subCategory ?? null) === (b.subCategory ?? null);

/** Last recorded crossing − start, or null. */
function totalOf(r: BreakdownRider): number | null {
  const start = startOf(r);
  const c = crossingsOf(r);
  if (start == null || c.size === 0) return null;
  const last = c.get(Math.max(...c.keys()));
  return last && last.ms >= start ? last.ms - start : null;
}

/** Classified order of a category: more laps first, then the earlier total time (Results' rule). */
export function categoryOrder<T extends BreakdownRider>(riders: T[]): T[] {
  return riders
    .filter((r) => !OUT.includes(r.status))
    .sort((a, b) => b.lapsCounter - a.lapsCounter || (totalOf(a) ?? Infinity) - (totalOf(b) ?? Infinity));
}

export function lapBreakdown(rider: BreakdownRider, field: BreakdownRider[]): RiderBreakdown {
  const category = field.filter((r) => sameCategory(r, rider));
  if (!category.some((r) => r.id === rider.id)) category.push(rider);
  const crossings = new Map(category.map((r) => [r.id, crossingsOf(r)]));
  const own = crossings.get(rider.id)!;
  const start = startOf(rider);
  const lastLap = Math.max(rider.lapsCounter || 0, own.size ? Math.max(...own.keys()) : 0);

  const rows: LapRow[] = [];
  for (let lap = 1; lap <= lastLap; lap++) {
    const cur = own.get(lap) ?? null;
    const prevMs = lap === 1 ? start : own.get(lap - 1)?.ms ?? null;
    const durationMs = cur && prevMs != null && cur.ms >= prevMs ? cur.ms - prevMs : null;

    let position: number | null = null;
    let gapMs: number | null = null;
    // Reliable only if no category rider is missing this passage while having a
    // later one: that rider's time at this lap is unknown and could be ahead.
    const unknownAhead = category.some((r) => {
      const c = crossings.get(r.id)!;
      return !c.has(lap) && [...c.keys()].some((k) => k > lap);
    });
    if (cur && !unknownAhead) {
      const times = category.map((r) => crossings.get(r.id)!.get(lap)?.ms).filter((t): t is number => t != null);
      position = 1 + times.filter((t) => t < cur.ms).length;
      gapMs = cur.ms - Math.min(...times);
    }
    rows.push({ lap, durationMs, crossingMs: cur?.ms ?? null, position, gapMs, recovered: !!cur?.recovered });
  }

  // Fastest lap: never a lap bounded by a recovered (estimated) passage.
  let fastestLapMs: number | null = null;
  let fastestLap: number | null = null;
  rows.forEach((r, i) => {
    const estimated = r.recovered || (i > 0 && rows[i - 1].recovered);
    if (r.durationMs != null && !estimated && (fastestLapMs == null || r.durationMs < fastestLapMs)) {
      fastestLapMs = r.durationMs;
      fastestLap = r.lap;
    }
  });

  const completedLaps = rider.lapsCounter || 0;
  const totalMs = totalOf(rider);
  // Average over the whole ride (start → last crossing), so a missing middle
  // passage doesn't skew it; only when the last counted lap has its crossing.
  const lastCounted = own.get(completedLaps);
  const averageLapMs =
    completedLaps > 0 && start != null && lastCounted && lastCounted.ms >= start
      ? (lastCounted.ms - start) / completedLaps
      : null;

  const isOut = OUT.includes(rider.status);
  const order = categoryOrder(category);
  const idx = order.findIndex((r) => r.id === rider.id);
  const position = isOut || idx < 0 || completedLaps === 0 ? null : idx + 1;

  let finalGap: FinalGap = null;
  const winner = order[0];
  if (position === 1) finalGap = { kind: "leader" };
  else if (position != null && winner) {
    if (winner.lapsCounter > completedLaps) finalGap = { kind: "laps", laps: winner.lapsCounter - completedLaps };
    else {
      const w = totalOf(winner);
      if (w != null && totalMs != null && totalMs >= w) finalGap = { kind: "time", ms: totalMs - w };
    }
  }

  return {
    rows,
    completedLaps,
    totalMs,
    position,
    finalGap,
    fastestLapMs,
    fastestLap,
    averageLapMs,
    adminFinish: isAdministrativeFinish(rider),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** MM:SS, or H:MM:SS from one hour. */
export function fmtDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "N/A";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** "+MM:SS" behind the leader ("+H:MM:SS" from one hour). */
export function fmtGapMs(ms: number | null): string {
  return ms == null ? "N/A" : `+${fmtDuration(ms)}`;
}

/** Local wall-clock HH:mm:ss of a crossing. */
export function fmtClock(ms: number | null): string {
  if (ms == null) return "N/A";
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
