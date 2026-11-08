/**
 * Spectator page refresh rule (0.3.4). Pure, so it is tested on its own.
 *
 *  - About every 60 s while a wave is RUNNING.
 *  - Every 5 min while the race day is still open but nothing runs (between waves),
 *    so a spectator sees the next wave start without keeping a fast poll.
 *  - Nothing once guest polling is closed (race finished, or 24 h after its start —
 *    shared/race/guestPolling.ts, also enforced by the server with 410).
 * The page pauses while the tab is hidden and revalidates when it comes back.
 * Anonymous spectators never open a WebSocket.
 */
import { guestPollingOpen } from "../../shared/race/guestPolling";

export const PUBLIC_REFRESH_RUNNING_MS = 60_000;
export const PUBLIC_REFRESH_IDLE_MS = 5 * 60_000;
/** A manual Refresh is ignored when the last request is younger than this. */
export const PUBLIC_MANUAL_REFRESH_MIN_MS = 10_000;
/** Returning to the tab refreshes only when the data is older than this. */
export const PUBLIC_FOCUS_REVALIDATE_MIN_MS = 15_000;

interface RaceLike { status?: string | null; date?: string | null; time?: string | null; createdAt?: string | null }
interface CategoryLike { status?: string | null; startTime?: string | null }

/** ms until the next automatic refresh, or null when the page should not poll. */
export function publicRefreshDelay(
  pollingOpen: boolean | undefined,
  race: RaceLike | null | undefined,
  categories: CategoryLike[],
  now = Date.now(),
): number | null {
  if (!pollingOpen || !race || !guestPollingOpen(race, categories, now)) return null;
  return categories.some((c) => c.status === "running") ? PUBLIC_REFRESH_RUNNING_MS : PUBLIC_REFRESH_IDLE_MS;
}

export type ShareTab = "results" | "race";

/**
 * `?tab=` of a shared link. RESULTS is the default; `race` opens RACE. A 0.3.2 Board
 * link (`?tab=board`, the race-progress screen) opens RACE too.
 */
export const shareTabFromParam = (p: string | null): ShareTab => (p === "race" || p === "board" ? "race" : "results");
