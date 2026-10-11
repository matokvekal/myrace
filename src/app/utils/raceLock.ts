/**
 * The single place that answers "is this race closed?".
 *
 * A race is FINALIZED once "Finish Race" (Info tab) stamps `RaceProps.finalized`.
 * From that moment the race is a published result: results are readable and
 * exportable, but riders, categories, schedule and race details can never
 * change again.
 *
 * Enforcement is deliberately BELOW the UI. Hiding buttons is the nice half;
 * the stores also refuse writes to a finalized race, so a screen nobody
 * remembered to gate — an old modal, a cloud sync, a stray effect — cannot
 * quietly rewrite a signed result. Never bypass these by writing to IndexedDB
 * directly.
 */

import type { RaceProps } from "@/types/types";
import useRaceStore from "@/stores/racesStore";

export function isRaceFinalized(race: RaceProps | null | undefined): boolean {
  return Boolean(race?.finalized);
}

/**
 * Non-hook lookup by uuid, for store guards and plain functions.
 * Unknown race -> not finalized: a write for a race we've never loaded is some
 * other flow's problem (import, seed), and blocking it here would break them.
 */
export function isRaceUuidFinalized(raceUuid: string | null | undefined): boolean {
  if (!raceUuid) return false;
  return isRaceFinalized(useRaceStore.getState().races.find((r) => r.uuid === raceUuid));
}

/** React hook — re-renders when the race is finalized. */
export function useRaceFinalized(raceUuid: string | null | undefined): boolean {
  return useRaceStore((s) =>
    Boolean(raceUuid && s.races.find((r) => r.uuid === raceUuid)?.finalized)
  );
}

/**
 * A race that this device may not modify: finalized, or a downloaded view-only
 * copy. Use this for UI gating; use `isRaceUuidFinalized` for the hard store
 * guards (a view-only race still gets written to by cloud sync).
 */
export function isRaceReadOnly(race: RaceProps | null | undefined): boolean {
  return isRaceFinalized(race) || Boolean(race?.viewOnly);
}

/**
 * Which race fields a finalized race still accepts writes to lives in
 * `stores/racesStore.ts` (`blockedFinalizedFields`) — keeping it there is what
 * lets this module import the store without a cycle.
 */

/** Shared message so every blocked path says the same thing. */
export const RACE_FINALIZED_MESSAGE =
  "This race is finished and locked. Results can be viewed and exported, but not changed.";
