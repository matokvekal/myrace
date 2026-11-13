/**
 * LIVE ranking motion — pure. Given the previous and the next provisional ranking (two
 * genuine feed updates of the SAME view), decides how each row should move:
 *
 *   gain / loss  — a PRIMARY mover: green ▲ / red ▼, travels to its new place, brief border.
 *                  A rider is primary when its own data changed (new crossing, new lap) and its
 *                  position changed. A position change nothing in the data explains (a
 *                  correction, a server re-order) is shown too — the change is a fact — but
 *                  flagged `cause: "unknown"`; no cause is ever claimed.
 *   out          — became DNF / DSQ / DNS: slides sideways out of the competitive list; it
 *                  stays visible in the DNF · DSQ · DNS section.
 *   (no entry)   — everyone else. Riders pushed along by a primary mover ("displaced") just
 *                  glide to their new row, with no arrow and no highlight.
 *
 * Positions are never changed here: the rows always show the current authoritative ranking;
 * motion only animates how they got there.
 */
import type { LiveEntry } from "./liveRanking";

export type MotionKind = "gain" | "loss" | "out";

export interface RankMotion {
  kind: MotionKind;
  /** Places gained (positive) or lost (negative); 0 for "out". */
  delta: number;
  /** "data": the rider's own new crossing / status explains it; "unknown": nothing in the data does. */
  cause: "data" | "unknown";
  /** 0-based order among the primary movers (for a restrained stagger). */
  order: number;
}

/** Riders that are only ever compared within the same context (one wave on TV). */
export type ContextOf = (e: LiveEntry) => string;
const ONE_CONTEXT: ContextOf = () => "";

/** Did this rider's own timing data change between the two rankings? */
function ownDataChanged(a: LiveEntry, b: LiveEntry): boolean {
  return a.laps !== b.laps || (a.rider.timeArrive ?? null) !== (b.rider.timeArrive ?? null) || a.group !== b.group;
}

export function classifyMotion(prev: LiveEntry[], next: LiveEntry[], contextOf: ContextOf = ONE_CONTEXT): Map<string, RankMotion> {
  const motions = new Map<string, RankMotion>();
  if (prev.length === 0) return motions;
  const before = new Map<string, { e: LiveEntry; i: number }>();
  prev.forEach((e, i) => before.set(e.uuid, { e, i }));
  const nextIndex = new Map<string, number>();
  next.forEach((e, i) => nextIndex.set(e.uuid, i));

  // Riders whose own data changed — the only ones that can explain someone else's move.
  const actors: { uuid: string; ctx: string; from: number; to: number }[] = [];
  const unexplained: LiveEntry[] = [];

  for (const e of next) {
    const p = before.get(e.uuid);
    if (!p) continue; // a rider new to this list: appears, never "moves"
    const changed = ownDataChanged(p.e, e);
    if (changed) actors.push({ uuid: e.uuid, ctx: contextOf(e), from: p.i, to: nextIndex.get(e.uuid)! });
    if (e.group === "out" && p.e.group !== "out") {
      motions.set(e.uuid, { kind: "out", delta: 0, cause: "data", order: 0 });
      continue;
    }
    const delta = p.e.position != null && e.position != null ? p.e.position - e.position : 0;
    if (delta === 0) continue;
    if (changed) motions.set(e.uuid, { kind: delta > 0 ? "gain" : "loss", delta, cause: "data", order: 0 });
    else unexplained.push(e);
  }

  // A rider that moved without new data of its own is "displaced" when some actor of the same
  // context passed it (or fell behind it): their relative order flipped. Otherwise the move is
  // shown, but its cause stays unknown.
  for (const e of unexplained) {
    const p = before.get(e.uuid)!;
    const to = nextIndex.get(e.uuid)!;
    const ctx = contextOf(e);
    const passed = actors.some((a) => a.ctx === ctx && a.uuid !== e.uuid && Math.sign(a.from - p.i) !== Math.sign(a.to - to));
    if (passed) continue;
    const delta = p.e.position! - e.position!;
    motions.set(e.uuid, { kind: delta > 0 ? "gain" : "loss", delta, cause: "unknown", order: 0 });
  }

  // Stagger in the order the rows now appear.
  [...motions.entries()]
    .sort((a, b) => nextIndex.get(a[0])! - nextIndex.get(b[0])!)
    .forEach(([, m], i) => (m.order = i));
  return motions;
}

/** Arrow / highlight only for primary movers (displaced riders glide silently). */
export const showsArrow = (m: RankMotion | undefined): m is RankMotion & { kind: "gain" | "loss" } => !!m && m.kind !== "out";
