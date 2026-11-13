/**
 * Position changes for LIVE: compares the CURRENT ranking with the previous one, but only
 * when new server data produced a new ranking (the ranking array is memoised on the feed's
 * riders, which keep their identity when an update brings nothing). Switching view (wave,
 * mode, category) resets the baseline, so a filter change never shows fake arrows.
 *
 * Returns uuid → places gained (positive = moved up), plus a version that changes on each
 * genuine update (used to replay the short highlight).
 */
import { useMemo, useRef } from "react";
import type { LiveEntry } from "./liveRanking";

export interface LiveTrend {
  deltas: Map<string, number>;
  version: number;
}

interface Memo {
  viewKey: string;
  ranking: LiveEntry[] | null;
  positions: Map<string, number>;
  trend: LiveTrend;
}

export function positionsOf(ranking: LiveEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of ranking) if (e.position != null) m.set(e.uuid, e.position);
  return m;
}

/** Pure: places gained between two position maps (riders without a position on either side are skipped). */
export function trendDeltas(prev: Map<string, number>, next: Map<string, number>): Map<string, number> {
  const d = new Map<string, number>();
  for (const [uuid, pos] of next) {
    const before = prev.get(uuid);
    if (before != null && before !== pos) d.set(uuid, before - pos);
  }
  return d;
}

const EMPTY: LiveTrend = { deltas: new Map(), version: 0 };

export function useLiveTrend(ranking: LiveEntry[], viewKey: string): LiveTrend {
  const memo = useRef<Memo>({ viewKey: "", ranking: null, positions: new Map(), trend: EMPTY });
  return useMemo(() => {
    const m = memo.current;
    if (m.ranking === ranking && m.viewKey === viewKey) return m.trend; // idempotent (StrictMode)
    const positions = positionsOf(ranking);
    if (m.viewKey !== viewKey || m.ranking === null) {
      memo.current = { viewKey, ranking, positions, trend: EMPTY };
      return EMPTY;
    }
    const deltas = trendDeltas(m.positions, positions);
    const trend = { deltas, version: m.trend.version + 1 };
    memo.current = { viewKey, ranking, positions, trend };
    return trend;
  }, [ranking, viewKey]);
}
