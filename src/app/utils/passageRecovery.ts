import type { RiderProps } from "@/types/types";
import { formatTime, parseClockTime } from "@/utils/timeUtils";

type Lap = RiderProps["lapsDetails"][number] & { recovered?: boolean; enteredAt?: string };

/** HH:mm (24 h) of a time — what RECAP and recovery show; full timestamps are kept. */
export const hhmm = (d: Date | string | number): string =>
  new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** The rider's recorded passages (lap end times), oldest first. */
export const passagesOf = (r: Pick<RiderProps, "lapsDetails">): Date[] =>
  (r.lapsDetails ?? []).map((l) => new Date(l.endTime)).sort((a, b) => a.getTime() - b.getTime());

export type RecoveryCheck =
  | { kind: "invalid"; reason: string }
  /** An existing passage lies within the minimum lap time: it may be this very crossing. Needs explicit confirmation. */
  | { kind: "near"; nearest: Date; becomesLap: number }
  | { kind: "ok"; becomesLap: number };

/**
 * Before a missed passage is added (RECAP): never decided by elapsed time
 * alone. The operator always sees the rider's existing passages and which lap
 * the recovered one becomes; a passage within the minimum lap time is shown as
 * possibly the same crossing and is never added silently.
 */
export function checkRecovery(
  rider: Pick<RiderProps, "timeStartRace" | "lapsDetails" | "lapsCounter" | "totalLaps" | "raceStatus" | "status">,
  estimatedAt: Date,
  minLapMs: number,
  now: Date = new Date()
): RecoveryCheck {
  const start = parseClockTime(rider.timeStartRace);
  if (!start) return { kind: "invalid", reason: "this rider has not started" };
  if (["DNF", "DSQ", "DNS"].includes(rider.status)) return { kind: "invalid", reason: `this rider is ${rider.status}` };
  if (estimatedAt.getTime() <= start.getTime()) return { kind: "invalid", reason: "the time is before the rider's start" };
  if (estimatedAt.getTime() > now.getTime()) return { kind: "invalid", reason: "the time is in the future" };
  if (rider.totalLaps > 0 && rider.lapsCounter >= rider.totalLaps) {
    return { kind: "invalid", reason: "the rider already has all their laps — correct the lap count instead" };
  }
  const passages = passagesOf(rider);
  const becomesLap = passages.filter((p) => p.getTime() < estimatedAt.getTime()).length + 1;
  const nearest = passages.reduce<Date | null>(
    (best, p) => (best === null || Math.abs(p.getTime() - estimatedAt.getTime()) < Math.abs(best.getTime() - estimatedAt.getTime()) ? p : best),
    null
  );
  if (nearest && Math.abs(nearest.getTime() - estimatedAt.getTime()) < minLapMs) return { kind: "near", nearest, becomesLap };
  return { kind: "ok", becomesLap };
}

/**
 * The rider with a recovered passage inserted at its estimated time: laps are
 * rebuilt in time order (lap numbers, lap times, arrival, elapsed, finish), the
 * recovered lap is marked `recovered` with its entry time. Same result the
 * shared engine re-derives for shared races.
 */
export function withRecoveredPassage(rider: RiderProps, estimatedAt: Date, enteredAt: Date): RiderProps {
  const start = parseClockTime(rider.timeStartRace) ?? estimatedAt;
  const entries: { at: Date; src?: Lap; recovered?: boolean }[] = [
    ...(rider.lapsDetails as Lap[]).map((l) => ({ at: new Date(l.endTime), src: l })),
    { at: estimatedAt, recovered: true },
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  let prev = start;
  const laps: Lap[] = entries.map((e, i) => {
    const lap: Lap = {
      ...(e.src ?? {}),
      lap: i + 1,
      startTime: prev,
      endTime: e.at,
      lapTime: formatTime((e.at.getTime() - prev.getTime()) / 1000),
      ...(e.recovered ? { recovered: true, enteredAt: enteredAt.toISOString() } : {}),
    } as Lap;
    prev = e.at;
    return lap;
  });
  const last = laps[laps.length - 1];
  const count = laps.length;
  const finished = rider.totalLaps > 0 && count >= rider.totalLaps;
  return {
    ...rider,
    lapsDetails: laps,
    lapsCounter: count,
    timeArrive: last.endTime.toISOString(),
    elapsedLastLap: last.lapTime,
    elapsedTimeFromStart: formatTime((last.endTime.getTime() - start.getTime()) / 1000),
    raceStatus: finished ? "finished" : rider.raceStatus,
  };
}
