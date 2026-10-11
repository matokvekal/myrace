import type { CategoryProps, RiderProps } from "@/types/types";

/**
 * What may still be edited on a category, derived from its race lifecycle.
 *
 *  - upcoming: everything is open.
 *  - running (wave started): the start slot is fixed — a different wave or start
 *    time would rewrite timing that riders are already being scored against.
 *    Laps may still change, but never below what any rider has already ridden,
 *    which would invalidate recorded laps.
 *  - finished: results are complete, so nothing about the category may change
 *    (colour included — it is part of the printed results).
 */
export interface CategoryLocks {
  color: boolean;
  wave: boolean;
  startTime: boolean;
  laps: boolean;
  /** Lowest lap count that does not invalidate recorded laps. */
  minLaps: number;
  /** Human reason shown next to any disabled control; null when nothing is locked. */
  reason: string | null;
}

export function getCategoryLocks(
  cat: Pick<CategoryProps, "status" | "name" | "subCategory">,
  riders: Pick<RiderProps, "category" | "subCategory" | "lapsCounter">[]
): CategoryLocks {
  const finished = cat.status === "finished";
  const started = finished || cat.status === "running";
  const minLaps = riders
    .filter((r) => r.category === cat.name && (r.subCategory ?? null) === (cat.subCategory ?? null))
    .reduce((m, r) => Math.max(m, r.lapsCounter || 0), 0);
  return {
    color: finished,
    wave: started,
    startTime: started,
    laps: finished,
    minLaps,
    reason: finished
      ? "This category has finished — it can no longer be edited."
      : started
        ? "This category has started — its wave and start time are locked."
        : null,
  };
}
