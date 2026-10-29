/**
 * "Finish Race" — closing a race for good.
 *
 * This is the one irreversible action in the app, so it is deliberately small
 * and explicit: compute the final classification, write it, then stamp a signed
 * record on the race. After that `utils/raceLock.ts` makes every further write
 * a no-op.
 *
 * What it is NOT: it does not finish a WAVE (that's `finishWave` in
 * StartManager, which a commissaire runs several times a day and can work
 * around). Finalizing is the end of the event.
 *
 * Ordering matters — riders and categories are persisted BEFORE the race is
 * stamped. Stamp first and the store guards would reject our own final write.
 */

import type { CategoryProps, RaceProps, RiderProps, RaceFinalization } from "@/types/types";
import calculatePositions from "./calculatePosition";
import { formatElapsedSince } from "./timeUtils";
import { signRaceFinalization } from "./raceSignature";
import useRaceStore from "@/stores/racesStore";
import useRiderStore from "@/stores/ridersStore";
import useCategoryStore from "@/stores/categoryStore";

const OUT_STATUSES: RiderProps["status"][] = ["DNF", "DSQ", "DNS"];

/** A rider the commissaire already classified out — never overwrite that. */
const isOut = (r: RiderProps): boolean => OUT_STATUSES.includes(r.status);

/**
 * Final classification for every rider in the race.
 *
 * Riders still on the road are credited as FINISHERS on the laps they actually
 * completed — the same rule `finishWave` uses. They are NOT turned into DNFs:
 * DNF is a human judgement a commissaire makes, never something inferred from
 * the clock (see StartManager's `closeOutRiderOnTrack`).
 *
 * DNS riders keep their status and stay out of the placings, but are still
 * closed out so nothing is left in a "running" state anywhere.
 *
 * Pure — returns new objects, touches nothing in the stores.
 */
export function computeFinalRiders(riders: RiderProps[], now: Date): RiderProps[] {
  const closed = riders.map((r) => ({
    ...r,
    raceStatus: "finished" as const,
    status: isOut(r) ? r.status : ("finished" as const),
    // Backfill only when missing: a real crossing time already recorded during
    // the race is the truth and must survive finalizing untouched.
    elapsedTimeFromStart:
      r.elapsedTimeFromStart ??
      (r.timeStartRace ? formatElapsedSince(now, r.timeStartRace) : null),
  }));

  // Rank the whole race at once, so `position_category` / `position_race` are
  // consistent across waves instead of whatever each live screen last showed.
  // `calculatePositions` skips out-status riders and returns clones.
  const ranked = new Map(calculatePositions(closed).map((r) => [r.id, r]));
  return closed.map((r) => {
    const placed = ranked.get(r.id);
    if (!placed) return r; // DNF/DSQ/DNS — keep whatever placing they had
    return {
      ...r,
      position_category: placed.position_category,
      position_race: placed.position_race,
    };
  });
}

/** Every category closed, keeping a real `finishedAt` if the wave already set one. */
export function computeFinalCategories(
  categories: CategoryProps[],
  now: Date
): CategoryProps[] {
  return categories.map((c) => ({
    ...c,
    status: "finished" as const,
    finishedAt: c.finishedAt ?? now.getTime(),
  }));
}

export interface FinalizeResult {
  finalized: RaceFinalization;
  riderCount: number;
  categoryCount: number;
}

/**
 * Run the whole close-out for one race and persist it.
 *
 * @param by identity stamped into the signature — the logged-in user's email/id,
 *           or "anonymous" for a purely local race.
 */
export async function finalizeRace(
  race: RaceProps,
  by: string,
  now: Date = new Date()
): Promise<FinalizeResult> {
  if (race.finalized) {
    throw new Error("This race has already been finished.");
  }

  const riders = useRiderStore
    .getState()
    .riders.filter((r) => r.raceUuid === race.uuid);
  const categories = useCategoryStore
    .getState()
    .categories.filter((c) => c.raceUuid === race.uuid);

  const finalRiders = computeFinalRiders(riders, now);
  const finalCategories = computeFinalCategories(categories, now);

  // 1. Results first — while the race is still writable.
  if (finalRiders.length > 0) {
    await useRiderStore.getState().patchRiders(finalRiders);
  }
  if (finalCategories.length > 0) {
    await useCategoryStore.getState().upsertCategories(finalCategories);
  }

  // 2. Sign exactly what was just stored, not the pre-close state.
  const finalized = await signRaceFinalization({
    race,
    categoryCount: finalCategories.length,
    riders: finalRiders,
    by,
    at: now.toISOString(),
  });

  // 3. Stamp the race last. This is what flips the lock on.
  await useRaceStore.getState().updateRace({
    ...race,
    status: "finished",
    finalized,
    lastUpdateAt: now,
  });

  return {
    finalized,
    riderCount: finalRiders.length,
    categoryCount: finalCategories.length,
  };
}
