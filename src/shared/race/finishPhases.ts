/**
 * Bell / flag state machine of a category (or an explicit Finish Group), shared
 * by the live screen and the server engine. Everything is DERIVED from recorded
 * crossing times — nothing extra is stored — so every device, a reload and the
 * server agree, and undoing a crossing undoes its effect.
 *
 * The icon tells the official what to show the rider at their NEXT crossing.
 * 5-lap example:
 *  1. 112 completes lap 3 → 112 BELL (2 to go); others unchanged.
 *  2. 112 completes lap 4 (gets the bell) → 112 FLAG (1 to go), and at that
 *     moment every other active rider of the group shows BELL, 2 to go,
 *     whatever their own count ("group bell").
 *  3. 102 crosses (gets the bell) → 102 FLAG, 1 to go; 107 stays BELL, 2 to go.
 *  4. 112 crosses again and finishes → the group is in its finish phase: every
 *     rider not yet finished shows FLAG, 0 to go, and finishes at their next
 *     crossing. Their own laps and crossing times are never changed, and no
 *     finish is recorded for anyone until they actually cross.
 * A FLAG rider's next crossing is their finish (also before the group's first
 * finish: 102 crossing again before 112 would be the first finish).
 */

export interface PhaseRider {
  /** The rider's own lap target (category laps first). */
  laps: number;
  /** Counted crossing times (ms), in order. */
  crossings: number[];
  /** The rider's race is over (raceStatus finished). */
  finished: boolean;
  /** DNF / DSQ / DNS: never a trigger. */
  out: boolean;
}

export interface GroupPhase {
  /** When the group's first rider got the bell (completed their second-to-last lap). */
  bellAt: number | null;
  /** When the group's first rider finished on the line. */
  finishAt: number | null;
}

export type PhaseIcon = "none" | "bell" | "flag" | "finished";

export interface RiderPhase {
  icon: PhaseIcon;
  /** Laps to go as shown to the official (phase-controlled, not target − laps). */
  remaining: number;
  /** The group's first rider has finished: this rider finishes at their next crossing. */
  finishPhase: boolean;
  /** This rider's next crossing is their finish. */
  nextCrossingFinishes: boolean;
}

export const NO_GROUP_PHASE: GroupPhase = { bellAt: null, finishAt: null };

const ownBellAt = (r: PhaseRider): number | null =>
  r.laps >= 2 && r.crossings.length >= r.laps - 1 ? r.crossings[r.laps - 2] : null;

/** The crossing at which the rider finished on the line, given the group bell, or null. */
export function lineFinishAt(r: PhaseRider, bellAt: number | null): number | null {
  if (!r.finished || r.out) return null;
  const own = r.laps > 0 && r.crossings.length >= r.laps ? r.crossings[r.laps - 1] : null;
  // Belled by the group (first crossing after the bell), then finished at the next one.
  const after = bellAt === null ? [] : r.crossings.filter((t) => t > bellAt);
  const flagged = after.length >= 2 ? after[1] : null;
  if (own === null) return flagged;
  return flagged === null ? own : Math.min(own, flagged);
}

/** The group's bell and first-finish times from its riders. */
export function groupPhase(riders: readonly PhaseRider[]): GroupPhase {
  let bellAt: number | null = null;
  for (const r of riders) {
    if (r.out) continue;
    const t = ownBellAt(r);
    if (t !== null && (bellAt === null || t < bellAt)) bellAt = t;
  }
  let finishAt: number | null = null;
  for (const r of riders) {
    const t = lineFinishAt(r, bellAt);
    if (t !== null && (finishAt === null || t < finishAt)) finishAt = t;
  }
  return { bellAt, finishAt };
}

/** What the official shows this rider at their next crossing, and laps to go. */
export function riderPhase(r: PhaseRider, g: GroupPhase): RiderPhase {
  const none = (remaining: number): RiderPhase => ({ icon: "none", remaining, finishPhase: false, nextCrossingFinishes: false });
  if (r.finished) return { icon: "finished", remaining: 0, finishPhase: false, nextCrossingFinishes: false };
  if (r.out) return none(Math.max(0, r.laps - r.crossings.length));
  if (g.finishAt !== null) return { icon: "flag", remaining: 0, finishPhase: true, nextCrossingFinishes: true };
  const own = r.laps > 0 ? r.laps - r.crossings.length : null;
  const afterBell = g.bellAt === null ? null : r.crossings.filter((t) => t > g.bellAt!).length;
  const flag: RiderPhase = { icon: "flag", remaining: 1, finishPhase: false, nextCrossingFinishes: true };
  if ((afterBell !== null && afterBell >= 1) || own === 1 || (own !== null && own <= 0)) return flag;
  if (afterBell === 0 || own === 2) return { icon: "bell", remaining: 2, finishPhase: false, nextCrossingFinishes: false };
  return none(own ?? 0);
}

/**
 * Whether a crossing at `at` finishes the rider, given their crossings before
 * it and the group's phase from the OTHER riders (bell/finish times).
 */
export function crossingFinishes(r: PhaseRider, before: number[], at: number, others: GroupPhase): boolean {
  const lapsAfter = before.length + 1;
  if (r.laps > 0 && lapsAfter >= r.laps) return true;
  if (others.finishAt !== null && at > others.finishAt) return true;
  return others.bellAt !== null && before.some((t) => t > others.bellAt!) && at > others.bellAt;
}
