import { CategoryProps, RiderProps } from "@/types/types";
import useCategoryStore from "@/stores/categoryStore";
import useRiderStore from "@/stores/ridersStore";
import useRaceStore from "@/stores/racesStore";
import { riderInCategory } from "../schedule/Schedule";
import { getCategoryBibIssues, describeBibIssues } from "@/utils/bibIssues";
import { isLiveRace, liveAllows, liveDispatch } from "@/services/live/liveBridge";

/**
 * Close out a rider still on the road as a finisher on the laps completed
 * (never DNF). Wave-level sweeps only — finishing a single category or start
 * leaves its riders running + ON TRACK (see StartManager.closeOutCategoryRiders).
 */
export const closeOutRiderOnTrack = (r: RiderProps): RiderProps => ({
  ...r,
  raceStatus: "finished" as const,
  status: ["DNF", "DSQ", "DNS"].includes(r.status) ? r.status : ("finished" as const),
});

/**
 * Starting a start group (a set of categories of one wave): the one shared
 * implementation behind Race → Grid (StartManager) and the race-day bottom
 * sheet. Moved here unchanged from StartManager so both use the same rules.
 */
export function useWaveStart(raceUuid: string, waveNum: number, categories: CategoryProps[]) {
  const { updateCategory, categories: allCategories } = useCategoryStore();
  const { riders, updateAllRiders } = useRiderStore();
  const { races, updateRace } = useRaceStore();

  // Rule: only one wave may run at a time. If any category OUTSIDE this wave is
  // running, this wave cannot be started until that one finishes.
  const thisWaveIds = new Set(categories.map((c) => c.id));
  const otherWaveRunning = allCategories.some(
    (c) => c.raceUuid === raceUuid && !thisWaveIds.has(c.id) && c.status === "running"
  );

  // Riders imported without a bib (bib 0) or sharing a bib can't be told apart in
  // live recording, so their category can't start until the manager fixes them.
  const getBibIssues = (cat: CategoryProps): string[] =>
    describeBibIssues(getCategoryBibIssues(cat, riders, raceUuid));

  const validateGroup = (categoryIds: number[]): string[] => {
    const errors: string[] = [];
    const cats = categoryIds
      .map((id) => categories.find((c) => c.id === id))
      .filter(Boolean) as CategoryProps[];

    if (cats.length === 0) {
      errors.push("No categories assigned to this start group");
      return errors;
    }

    for (const cat of cats) {
      if (!cat.laps || cat.laps <= 0) {
        errors.push(`"${cat.name}": no laps configured`);
      }
      getBibIssues(cat).forEach((i) => errors.push(`"${cat.name}": ${i}`));
      const catRiders = riders.filter(
        (r) => riderInCategory(r, cat) && r.raceUuid === raceUuid && r.status !== "DNS"
      );
      if (catRiders.length === 0) {
        errors.push(`"${cat.name}": no riders assigned`);
      } else {
        const unchecked = catRiders.filter(
          (r) => !r.checked && !["DNS", "DNF", "DSQ"].includes(r.status)
        );
        if (unchecked.length > 0) {
          errors.push(
            `"${cat.name}": ${unchecked.length} rider${unchecked.length > 1 ? "s" : ""} not checked in`
          );
        }
      }
    }
    return errors;
  };

  /** Starts the group's upcoming categories. Callers check otherWaveRunning and validateGroup first. */
  const startGroup = async (categoryIds: number[]): Promise<boolean> => {
    // Shared race: one WaveStarted for this start group (the server stamps the start time).
    const groupCats = categoryIds.map((id) => categories.find((c) => c.id === id)).filter(Boolean) as CategoryProps[];
    const startPayload = {
      heat: groupCats[0]?.heat ?? Number(waveNum),
      categoryUuids: groupCats.filter((c) => c.status === "upcoming" && c.uuid).map((c) => c.uuid!),
    };
    if (!liveAllows(raceUuid, "WaveStarted", startPayload)) return false;
    if (isLiveRace(raceUuid) && startPayload.categoryUuids.length) void liveDispatch(raceUuid, "WaveStarted", startPayload);

    const now = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    const race = races.find((r) => r.uuid === raceUuid);
    if (race) await updateRace({ ...race, status: "running" });

    const cats = categoryIds
      .map((id) => categories.find((c) => c.id === id))
      .filter(Boolean) as CategoryProps[];

    const allUpdatedRiders: RiderProps[] = [];

    // Clear the track from the previous wave: any rider whose category already
    // finished but who is still "running" (was on the road when the race ended)
    // is finalized now, so starting a new wave leaves no ghosts behind on Live.
    // They are credited as finishers on the laps they completed — never DNF.
    riders
      .filter((r) => r.raceUuid === raceUuid && r.raceStatus === "running")
      .forEach((r) => {
        const cat = allCategories.find((c) => c.raceUuid === raceUuid && riderInCategory(r, c));
        if (cat?.status === "finished") {
          allUpdatedRiders.push(closeOutRiderOnTrack(r));
        }
      });

    for (const cat of cats) {
      if (cat.status !== "upcoming") continue;
      const catRiders = riders.filter(
        (r) =>
          riderInCategory(r, cat) &&
          r.raceUuid === raceUuid &&
          r.status !== "DNS"
      );
      await updateCategory({
        ...cat,
        status: "running" as const,
        lapsCounter: 0,
        riders: catRiders.length,
      });
      catRiders.forEach((r, i) => {
        allUpdatedRiders.push({
          ...r,
          raceStatus: "running" as const,
          timeStartRace: now,
          lapsCounter: 0,
          viewOrder: r.position_start ?? i + 1,
        });
      });
    }

    if (allUpdatedRiders.length > 0) {
      await updateAllRiders(allUpdatedRiders);
    }
    return true;
  };

  return { otherWaveRunning, validateGroup, startGroup };
}
