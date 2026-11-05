import type { CategoryProps, RiderProps } from "@/types/types";

/**
 * Ignored waves (category.ignored): the organizer set a wave aside — e.g. one
 * created by a bad import. Its categories and riders are kept untouched, but
 * every race operation leaves them out: start controls, lap recording,
 * positions and results. Setup screens (Schedule, Categories, Riders) still
 * show them, marked Ignored, with Restore.
 */
export const isIgnoredCategory = (c: Pick<CategoryProps, "ignored"> | null | undefined): boolean => !!c?.ignored;

/** Categories that take part in race operations. */
export const activeCategories = <T extends Pick<CategoryProps, "ignored">>(cats: T[]): T[] => cats.filter((c) => !c.ignored);

const key = (name: string, sub: string | null | undefined) => `${name}::${sub ?? ""}`;

/** Riders whose category (name + subCategory) is ignored in this race. */
export function isRiderIgnored(rider: Pick<RiderProps, "category" | "subCategory" | "raceUuid">, cats: CategoryProps[]): boolean {
  return cats.some((c) => c.ignored && c.raceUuid === rider.raceUuid && key(c.name, c.subCategory) === key(rider.category, rider.subCategory));
}

/** Riders without the ones in ignored waves. */
export function withoutIgnoredRiders<T extends Pick<RiderProps, "category" | "subCategory" | "raceUuid">>(riders: T[], cats: CategoryProps[]): T[] {
  const ignored = new Set(cats.filter((c) => c.ignored).map((c) => `${c.raceUuid}|${key(c.name, c.subCategory)}`));
  if (ignored.size === 0) return riders;
  return riders.filter((r) => !ignored.has(`${r.raceUuid}|${key(r.category, r.subCategory)}`));
}
