/**
 * Spectator page refresh rule (0.3.4). Pure, so it is tested on its own.
 *
 *  - About every 60 s while a wave is RUNNING.
 *  - Every 5 min while the race day is still open but nothing runs (between waves),
 *    so a spectator sees the next wave start without keeping a fast poll.
 *  - Nothing once guest polling is closed (race finished, or 24 h after its start —
 *    shared/race/guestPolling.ts, also enforced by the server with 410).
 *  - 2.0: about every 20 s while a wave is RUNNING and the LIVE tab is open (`liveTab`);
 *    every other tab keeps the rule above.
 * The page pauses while the tab is hidden and revalidates when it comes back.
 * Anonymous spectators never open a WebSocket.
 */
import { guestPollingOpen } from "../../shared/race/guestPolling";

export const PUBLIC_REFRESH_RUNNING_MS = 60_000;
export const PUBLIC_REFRESH_IDLE_MS = 5 * 60_000;
/** 2.0: LIVE tab open while a wave runs. */
export const PUBLIC_REFRESH_LIVE_MS = 20_000;
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
  opts: { liveTab?: boolean } = {},
): number | null {
  if (!pollingOpen || !race || !guestPollingOpen(race, categories, now)) return null;
  if (!categories.some((c) => c.status === "running")) return PUBLIC_REFRESH_IDLE_MS;
  return opts.liveTab ? PUBLIC_REFRESH_LIVE_MS : PUBLIC_REFRESH_RUNNING_MS;
}

export type ShareTab = "race" | "results" | "live";

/**
 * `?tab=` of a shared link. 2.0: RACE is the default; `results` opens RESULTS, `live` LIVE.
 * A 0.3.2 Board link (`?tab=board`, the race-progress screen) opens RACE.
 */
export const shareTabFromParam = (p: string | null): ShareTab => (p === "results" ? "results" : p === "live" ? "live" : "race");
