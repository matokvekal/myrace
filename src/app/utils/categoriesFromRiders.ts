import { CategoryProps, RiderProps } from "@/types/types";
import { assignCategoryColors } from "@/utils/colorAssignment";
import { COLORS } from "@/constants/index";
import { newLocalId } from "@/utils/localId";

/** "8:05" / "08:05:00" → "08:05"; non-zero seconds are kept (08:22:30 is its own start). */
const normTime = (t: string | null | undefined): string | null => {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const hhmm = `${m[1].padStart(2, "0")}:${m[2]}`;
  return m[3] && m[3] !== "00" ? `${hhmm}:${m[3]}` : hhmm;
};

/** The identity of a rider's category (name + legacy sub-category). */
export const riderCategoryKey = (r: { category: string; subCategory?: string | null }) =>
  r.subCategory ? `${r.category}::${r.subCategory}` : r.category;

/**
 * One category per distinct rider category, the way an import creates them:
 * laps, wave and start time from the first rider in it, file order kept in
 * `importOrder`, colours assigned only once every category and start time is
 * known (BUGS.md #6) unless the organizer turned Auto color off. Pure — the
 * callers store the result (local race) or send it (shared race).
 */
export function buildCategoriesFromRiders(riders: RiderProps[], raceUuid: string, autoColor: boolean): CategoryProps[] {
  const own = riders.filter((r) => r.raceUuid === raceUuid && r.category);
  // Order categories first appear in the file (rider ids ascend with row order).
  const fileOrder = new Map<string, number>();
  [...own].sort((a, b) => a.id - b.id).forEach((r) => {
    const key = riderCategoryKey(r);
    if (!fileOrder.has(key)) fileOrder.set(key, fileOrder.size);
  });
  const sorted = [...own].sort((a, b) => {
    const byName = a.category.localeCompare(b.category);
    if (byName !== 0) return byName;
    const tA = a.timeStartRace ? new Date(a.timeStartRace).getTime() : 0;
    const tB = b.timeStartRace ? new Date(b.timeStartRace).getTime() : 0;
    return tA - tB;
  });

  const map: Record<string, CategoryProps> = {};
  for (const r of sorted) {
    const key = riderCategoryKey(r);
    if (!map[key]) {
      const n = Object.keys(map).length;
      map[key] = {
        id: newLocalId(),
        raceUuid,
        name: r.category,
        subCategory: r.subCategory || null,
        laps: r.totalLaps || 0,
        lapsCounter: 0,
        riders: 0,
        startTime: normTime(r.timeStartRace),
        isConnected: false,
        color: COLORS[n % COLORS.length].code, // provisional, see below
        heat: r.heat || null,
        importOrder: fileOrder.get(key),
        status: "upcoming",
      };
    }
    map[key].riders = (map[key].riders ?? 0) + 1;
  }

  const categories = Object.values(map);
  if (autoColor) {
    const palette = assignCategoryColors(categories);
    for (const c of categories) {
      const assigned = palette.get(`${c.name}::${c.subCategory ?? ""}`);
      if (assigned) c.color = assigned;
    }
  }
  return categories;
}
