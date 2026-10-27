import type { RaceProps } from "@/types/types";

/** New races: 3 minutes between two counted passages of the same rider. */
export const DEFAULT_MIN_LAP_SECONDS = 180;
/** Races created before the setting existed (unset) keep the 60 s they were recorded with. */
export const LEGACY_MIN_LAP_SECONDS = 60;
/** Choices offered in Race Settings (seconds). */
export const MIN_LAP_CHOICES = [30, 60, 90, 120, 180, 240, 300, 360, 480, 600];

/** The race's minimum lap interval in ms — the same rule as the shared engine (raceMinLapMs). */
export const minLapMsFor = (race: Pick<RaceProps, "minLapSeconds"> | null | undefined): number =>
  (race?.minLapSeconds ?? LEGACY_MIN_LAP_SECONDS) * 1000;

export const formatMinLap = (seconds: number): string =>
  seconds < 60 ? `${seconds} s` : seconds % 60 === 0 ? `${seconds / 60} min` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
