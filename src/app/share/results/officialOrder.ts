/**
 * The spectator RESULTS order (moved unchanged from SharePage.tsx in 2.0 so the TV broadcast
 * uses the very same rule): classified first by the server's `position_category`, then on
 * course by laps, then DNF/DSQ/DNS. Never recalculates an official position.
 */
import type { PublicRider } from "../usePublicRaceFeed";
import { isOutRider } from "../waves/activeWaves";

/** Classified first (by the server's category position), then on course by laps, then DNF/DSQ/DNS. */
export function rankRiders<T extends PublicRider>(list: T[]): T[] {
  const score = (r: T) => (isOutRider(r) ? 2 : r.position_category ? 0 : 1);
  return [...list].sort(
    (a, b) =>
      score(a) - score(b) ||
      (a.position_category ?? 1e9) - (b.position_category ?? 1e9) ||
      (b.lapsCounter ?? 0) - (a.lapsCounter ?? 0) ||
      (a.bibNumber ?? 1e9) - (b.bibNumber ?? 1e9),
  );
}
