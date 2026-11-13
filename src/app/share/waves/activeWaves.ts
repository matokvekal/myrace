/**
 * Public page (2.0): which waves exist and which are RUNNING, from the public feed only.
 * Pure, so RACE, LIVE and the TV broadcast all use the SAME rules.
 *
 *  - A wave = the categories sharing `category.heat` (single source of truth for the wave;
 *    the rider's own `heat` copy is never used). Categories without a wave form one "—" group.
 *  - A wave is ACTIVE (running) when at least one of its categories has `status === "running"`.
 *    Never inferred from rider positions or laps.
 *  - Category state is the existing spectator rule: running / finished (and actually started) /
 *    otherwise upcoming. Wave state: running if any category runs, finished when all are finished.
 */
import type { SharedCategory } from "../../../shared/race/state";
import type { PublicRider } from "../usePublicRaceFeed";

export type CatState = "upcoming" | "running" | "finished";

export const OUT_STATUSES = ["DNF", "DSQ", "DNS"] as const;
export const isOutRider = (r: PublicRider) => (OUT_STATUSES as readonly string[]).includes(String(r.status));
/** Finished on course (never DNF/DSQ/DNS). */
export const isFinishedRider = (r: PublicRider) => !isOutRider(r) && (r.raceStatus === "finished" || r.status === "finished");
export const isOnCourse = (r: PublicRider) => !isOutRider(r) && !isFinishedRider(r) && r.raceStatus === "running";

export const categoryKey = (name?: string | null, sub?: string | null) => `${name ?? ""}::${sub ?? ""}`;
export const categoryLabel = (c: Pick<SharedCategory, "name" | "subCategory">) => (c.subCategory ? `${c.name} ${c.subCategory}` : c.name);
export const NO_WAVE = "—";
export const waveKeyOf = (c: Pick<SharedCategory, "heat">) => (c.heat != null ? String(c.heat) : NO_WAVE);
export const waveLabel = (key: string) => (key === NO_WAVE ? "Not scheduled" : `Wave ${key}`);

export function categoryState(c: SharedCategory): CatState {
  if (c.status === "running") return "running";
  if (c.status === "finished" && c.startedAt != null) return "finished";
  return "upcoming";
}

export interface WaveSummary {
  key: string;
  state: CatState;
  categories: SharedCategory[];
  riders: PublicRider[];
  /** Earliest actual start (server epoch ms) of the wave's started categories, or null. */
  startedAt: number | null;
  /** Latest finish (epoch ms) once the wave is finished, else null. */
  finishedAt: number | null;
  /** Earliest scheduled "HH:MM", display only. */
  scheduledStart: string | null;
  total: number;
  onCourse: number;
  finished: number;
  out: number;
}

/** Riders grouped by their category key (`name::subCategory`). */
export function ridersByCategory(riders: Iterable<PublicRider>): Map<string, PublicRider[]> {
  const m = new Map<string, PublicRider[]>();
  for (const r of riders) {
    const k = categoryKey(r.category, r.subCategory);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

const waveOrder = (a: string, b: string) => {
  if (a === b) return 0;
  if (a === NO_WAVE) return 1;
  if (b === NO_WAVE) return -1;
  return Number(a) - Number(b) || a.localeCompare(b);
};

/** Every wave of the race, in wave order, with its counts. */
export function summarizeWaves(categories: SharedCategory[], byCategory: Map<string, PublicRider[]>): WaveSummary[] {
  const groups = new Map<string, SharedCategory[]>();
  for (const c of categories) {
    const k = waveKeyOf(c);
    const list = groups.get(k);
    if (list) list.push(c);
    else groups.set(k, [c]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => waveOrder(a, b))
    .map(([key, cats]) => {
      const sorted = [...cats].sort(
        (a, b) => String(a.startTime ?? "").localeCompare(String(b.startTime ?? "")) || (a.importOrder ?? 0) - (b.importOrder ?? 0) || a.name.localeCompare(b.name),
      );
      const states = sorted.map(categoryState);
      const state: CatState = states.includes("running") ? "running" : states.every((s) => s === "finished") ? "finished" : "upcoming";
      const riders = sorted.flatMap((c) => byCategory.get(categoryKey(c.name, c.subCategory)) ?? []);
      const starts = sorted.map((c) => c.startedAt).filter((t): t is number => typeof t === "number" && t > 0);
      const ends = sorted.map((c) => c.finishedAt).filter((t): t is number => typeof t === "number" && t > 0);
      const scheduled = sorted.map((c) => c.startTime).filter((t): t is string => !!t).sort();
      return {
        key,
        state,
        categories: sorted,
        riders,
        startedAt: starts.length ? Math.min(...starts) : null,
        finishedAt: state === "finished" && ends.length ? Math.max(...ends) : null,
        scheduledStart: scheduled[0] ?? null,
        total: riders.length,
        onCourse: riders.filter(isOnCourse).length,
        finished: riders.filter(isFinishedRider).length,
        out: riders.filter(isOutRider).length,
      };
    });
}

export const activeWaves = (waves: WaveSummary[]) => waves.filter((w) => w.state === "running");
/** The next wave to start (first not-started wave in wave order), or null. */
export const nextWave = (waves: WaveSummary[]) => waves.find((w) => w.state === "upcoming" && w.key !== NO_WAVE) ?? null;
