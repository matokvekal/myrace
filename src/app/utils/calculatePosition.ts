import { RiderProps } from "@/types/types";

/**
 * Rank riders by finishing order and assign `position_category` / `position_race`.
 *
 * PURE (BUGS.md #12 / BUG-03): the input riders are Zustand store objects, so
 * this must never mutate them or their array — LiveBoard/LiveCards call it during
 * render purely to display, and the old in-place mutation silently rewrote store
 * state on every render (React never saw it; the single source of truth drifted).
 * It works on clones and returns a fresh, sorted array of new objects. Callers
 * read positions from the return value.
 *
 * Grouping for `position_category` uses the composite identity (name +
 * subCategory), matching the rest of the app — the same category name in two
 * waves stays ranked separately.
 */

const timeMs = (time: string | null): number => (time ? new Date(time).getTime() || 0 : 0);

const OUT_STATUSES = new Set<RiderProps["status"]>(["DNF", "DNS", "DSQ"]);

/**
 * Higher lap count first, then earlier arrival.
 *
 * A rider who was still on the road when the wave closed is credited as a
 * finisher but has NO `timeArrive` for a lap they never completed. On equal
 * laps they place BEHIND everyone who actually crossed the line: a missing
 * time used to read as 0 and sorted them ahead of the whole field.
 *
 * So a rider who completed 5 laps and came in at 14:33 beats a rider who
 * completed 5 laps at 14:32, went out for lap 6 and never returned.
 */
const byPlace = (a: RiderProps, b: RiderProps): number => {
   if (b.lapsCounter !== a.lapsCounter) return b.lapsCounter - a.lapsCounter;
   const aTime = timeMs(a.timeArrive);
   const bTime = timeMs(b.timeArrive);
   if (!aTime || !bTime) return (aTime ? 0 : 1) - (bTime ? 0 : 1);
   return aTime - bTime;
};

const calculatePositions = (riders: RiderProps[]): RiderProps[] => {
   // Clone up front so nothing downstream can touch the store objects.
   const active = riders
      .filter((rider) => !OUT_STATUSES.has(rider.status))
      .map((rider) => ({ ...rider }));

   // position_category — within each category (name + subCategory).
   const groups = new Map<string, RiderProps[]>();
   for (const rider of active) {
      const key = `${rider.category}::${rider.subCategory ?? ""}`;
      let group = groups.get(key);
      if (!group) {
         group = [];
         groups.set(key, group);
      }
      group.push(rider);
   }
   for (const group of groups.values()) {
      group.sort(byPlace);
      group.forEach((rider, index) => {
         rider.position_category = index + 1;
      });
   }

   // position_race — overall order (same clone instances, so both fields stick).
   const sorted = [...active].sort(byPlace);
   sorted.forEach((rider, index) => {
      rider.position_race = index + 1;
   });

   return sorted;
};

export default calculatePositions;
