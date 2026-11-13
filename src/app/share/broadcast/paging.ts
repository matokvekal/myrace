/**
 * TV broadcast paging — pure. How many rows fit is measured on screen; this decides what
 * each page shows. When the list doesn't fit, the leaders (top 3) stay pinned on every page
 * and the rest cycles below them, as on TV timing graphics.
 */
export interface PagePlan {
  /** Rows pinned at the top of every page (0 when everything fits or the screen is too short). */
  pinned: number;
  /** [start, end) slices of the list (after the pinned rows) for each page. Always ≥ 1 page. */
  pages: [number, number][];
}

export const PINNED_LEADERS = 3;
/** Below this many rows per page, pinning would leave too little room for the rest. */
const MIN_ROWS_FOR_PINNING = 8;

export function pagePlan(total: number, perPage: number, pinnedMax = PINNED_LEADERS): PagePlan {
  const per = Math.max(1, Math.floor(perPage));
  if (total <= per) return { pinned: 0, pages: [[0, total]] };
  const pinned = per >= MIN_ROWS_FOR_PINNING ? Math.min(pinnedMax, total) : 0;
  const room = per - pinned;
  const pages: [number, number][] = [];
  for (let s = pinned; s < total; s += room) pages.push([s, Math.min(total, s + room)]);
  return { pinned, pages };
}

/** Rows of a given height that fit in a box (never less than 1). */
export const rowsThatFit = (boxPx: number, rowPx: number) => (rowPx > 0 ? Math.max(1, Math.floor(boxPx / rowPx)) : 1);
