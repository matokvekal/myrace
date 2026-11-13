/**
 * LIVE provisional standings (public page 2.0) — pure, computed in the browser from the
 * public feed. Never official: RESULTS (server `position_category`, approvals, Finish Race)
 * is the only official order.
 *
 * Rules (see the official engine, shared/race/engine.ts `rankRiders`: laps desc, then the
 * earlier crossing):
 *  - Only riders of ONE wave are ranked together; waves are never mixed, so incompatible
 *    wave start times are never compared.
 *  - Three groups, in this order:
 *      racing  — at least one valid crossing (lapsCounter > 0 and a crossing time);
 *      waiting — started but not crossed yet: no position, no time (never a made-up 0);
 *      out     — DNF, DSQ, DNS: never a competitive position.
 *  - Racing order: more laps first; same laps → shorter race time (`riderElapsedMs`: the
 *    rider's own lap-1 start → last crossing, absolute instants, so categories of one wave
 *    that went off at different moments still compare fairly); a missing time sorts after a
 *    known one; then bib, then uuid (deterministic).
 *  - By category: the server's `position_category` (the official engine's order inside the
 *    category) wins whenever both riders carry one; the rule above otherwise.
 *  - Gap to the leader of the list: same laps → time difference; fewer laps → "+N laps";
 *    unknown → none. Nothing is estimated.
 */
import { riderElapsedMs } from "@/utils/timeUtils";
import { STATUS_LABEL } from "@/utils/statusLabels";
import type { SharedCategory } from "../../../shared/race/state";
import type { PublicRider } from "../usePublicRaceFeed";
import { categoryKey, isFinishedRider, isOutRider } from "../waves/activeWaves";

export type LiveMode = "overall" | "category";
export type LiveGroup = "racing" | "waiting" | "out";
export type LiveGap = { kind: "leader" } | { kind: "time"; ms: number } | { kind: "laps"; laps: number } | { kind: "none" };

export interface LiveEntry {
  uuid: string;
  rider: PublicRider;
  group: LiveGroup;
  /** 1-based provisional position; null for waiting and out riders. */
  position: number | null;
  laps: number;
  /** The category's laps (category is the source of truth), else the rider's cache; null = unknown. */
  totalLaps: number | null;
  elapsedMs: number | null;
  gap: LiveGap;
  /** FINISHED / RUNNING / NOT STARTED, or DNF / DSQ / DNS. */
  status: string;
  finished: boolean;
  category: SharedCategory | null;
}

const OUT_ORDER: Record<string, number> = { DNF: 0, DSQ: 1, DNS: 2 };

function validCrossing(r: PublicRider): boolean {
  if (!r.lapsCounter || r.lapsCounter <= 0) return false;
  return !!r.timeArrive && Number.isFinite(Date.parse(r.timeArrive));
}

export function liveElapsedMs(r: PublicRider): number | null {
  if (!validCrossing(r)) return null;
  // riderElapsedMs reads lap 1 from the FIRST entry: order by lap number so laps that
  // arrive out of order can't shift the start.
  const laps = r.lapsDetails?.length ? [...r.lapsDetails].sort((a, b) => (a.lap ?? 0) - (b.lap ?? 0)) : null;
  return riderElapsedMs({
    timeStartRace: r.timeStartRace ?? null,
    timeArrive: r.timeArrive ?? null,
    elapsedTimeFromStart: r.elapsedTimeFromStart ?? null,
    lapsDetails: laps,
  });
}

function statusOf(r: PublicRider): string {
  if (isOutRider(r)) return String(r.status);
  if (isFinishedRider(r)) return STATUS_LABEL.finished;
  if (r.raceStatus === "running") return STATUS_LABEL.running;
  return STATUS_LABEL.upcoming;
}

const byBib = (a: LiveEntry, b: LiveEntry) =>
  (a.rider.bibNumber ?? 1e9) - (b.rider.bibNumber ?? 1e9) || a.uuid.localeCompare(b.uuid);

function compareRacing(mode: LiveMode) {
  return (a: LiveEntry, b: LiveEntry): number => {
    if (mode === "category") {
      const pa = a.rider.position_category ?? 0;
      const pb = b.rider.position_category ?? 0;
      if (pa > 0 && pb > 0 && pa !== pb) return pa - pb;
    }
    if (a.laps !== b.laps) return b.laps - a.laps;
    if (a.elapsedMs != null && b.elapsedMs != null && a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
    if ((a.elapsedMs == null) !== (b.elapsedMs == null)) return a.elapsedMs == null ? 1 : -1;
    return byBib(a, b);
  };
}

/**
 * Rank one list of riders (one wave, or one category of one wave).
 * `categories` resolves each rider's category (for laps and colour).
 */
export function rankLive(riders: Iterable<PublicRider>, categories: Map<string, SharedCategory>, mode: LiveMode = "overall"): LiveEntry[] {
  const seen = new Set<string>();
  const entries: LiveEntry[] = [];
  for (const r of riders) {
    if (!r.uuid || seen.has(r.uuid)) continue; // duplicate data never produces two rows
    seen.add(r.uuid);
    const category = categories.get(categoryKey(r.category, r.subCategory)) ?? null;
    const out = isOutRider(r);
    const racing = !out && validCrossing(r);
    entries.push({
      uuid: r.uuid,
      rider: r,
      group: out ? "out" : racing ? "racing" : "waiting",
      position: null,
      laps: Math.max(0, r.lapsCounter ?? 0),
      totalLaps: category?.laps || r.totalLaps || null,
      elapsedMs: racing ? liveElapsedMs(r) : null,
      gap: { kind: "none" },
      status: statusOf(r),
      finished: isFinishedRider(r),
      category,
    });
  }

  const racing = entries.filter((e) => e.group === "racing").sort(compareRacing(mode));
  const waiting = entries.filter((e) => e.group === "waiting").sort(byBib);
  const out = entries
    .filter((e) => e.group === "out")
    .sort((a, b) => (OUT_ORDER[a.status] ?? 9) - (OUT_ORDER[b.status] ?? 9) || b.laps - a.laps || byBib(a, b));

  const leader = racing[0];
  racing.forEach((e, i) => {
    e.position = i + 1;
    if (i === 0) e.gap = { kind: "leader" };
    else if (e.laps < leader.laps) e.gap = { kind: "laps", laps: leader.laps - e.laps };
    else if (e.elapsedMs != null && leader.elapsedMs != null) e.gap = { kind: "time", ms: Math.max(0, e.elapsedMs - leader.elapsedMs) };
    else e.gap = { kind: "none" };
  });
  return [...racing, ...waiting, ...out];
}

/** "1:02:03" / "12:03" — race time, never padded to a fake zero. */
export function formatRaceTime(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function formatGap(gap: LiveGap): string {
  switch (gap.kind) {
    case "leader":
      return "Leader";
    case "time":
      return `+${formatRaceTime(gap.ms)}`;
    case "laps":
      return `+${gap.laps} lap${gap.laps === 1 ? "" : "s"}`;
    default:
      return "—";
  }
}

/** Display name: first (middle) LAST. */
export const riderName = (r: PublicRider) => [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ");

/** "3/5", "3" when the category laps are unknown. */
export const lapsText = (e: Pick<LiveEntry, "laps" | "totalLaps">) => (e.totalLaps ? `${e.laps}/${e.totalLaps}` : String(e.laps));
