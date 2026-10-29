import type { CategoryProps, RiderProps } from "@/types/types";
import { buildSchedule, catWaveKey, DEFAULT_WAVE_GAP_MINUTES } from "../race/[id]/schedule/Schedule";

/**
 * Case-insensitive partial match on first name, last name, full name (either
 * order) or bib. An empty query matches everyone.
 */
export function matchesRiderSearch(
  r: Pick<RiderProps, "firstName" | "lastName" | "bibNumber">,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const first = (r.firstName ?? "").toLowerCase();
  const last = (r.lastName ?? "").toLowerCase();
  return (
    first.includes(q) ||
    last.includes(q) ||
    `${first} ${last}`.includes(q) ||
    `${last} ${first}`.includes(q) ||
    String(r.bibNumber ?? "").includes(q)
  );
}

export interface RiderCategoryGroup {
  key: string;
  category: CategoryProps | null;
  name: string;
  riders: RiderProps[];
}
export interface RiderWaveGroup {
  wave: number | null;
  categories: RiderCategoryGroup[];
  count: number;
}

/**
 * Wave → Category → Riders. Waves ascend (riders in no wave last); categories
 * follow the schedule's own order inside a wave; riders keep the order they were
 * passed in, so the caller's sort applies within each category.
 */
export function groupRidersByWaveAndCategory(
  riders: RiderProps[],
  categories: CategoryProps[]
): RiderWaveGroup[] {
  const schedule = buildSchedule(categories, DEFAULT_WAVE_GAP_MINUTES);
  const waveOfCat = new Map<string, number>();
  const catOrder = new Map<string, number>();
  const catByKey = new Map<string, CategoryProps>();
  let order = 0;
  [...schedule.keys()].sort((a, b) => a - b).forEach((waveNum) => {
    schedule.get(waveNum)!.forEach((cats) =>
      cats.forEach((c) => {
        const k = catWaveKey(c.name, c.subCategory);
        waveOfCat.set(k, waveNum);
        catOrder.set(k, order++);
        catByKey.set(k, c);
      })
    );
  });

  const waves = new Map<number | null, Map<string, RiderCategoryGroup>>();
  for (const r of riders) {
    const k = catWaveKey(r.category, r.subCategory);
    const wave = waveOfCat.get(k) ?? null;
    if (!waves.has(wave)) waves.set(wave, new Map());
    const cats = waves.get(wave)!;
    if (!cats.has(k)) {
      cats.set(k, {
        key: k,
        category: catByKey.get(k) ?? null,
        name: r.subCategory ? `${r.category} · ${r.subCategory}` : r.category || "—",
        riders: [],
      });
    }
    cats.get(k)!.riders.push(r);
  }

  return [...waves.entries()]
    .sort(([a], [b]) => (a ?? Infinity) - (b ?? Infinity))
    .map(([wave, cats]) => {
      const categoriesSorted = [...cats.values()].sort(
        (a, b) => (catOrder.get(a.key) ?? Infinity) - (catOrder.get(b.key) ?? Infinity)
      );
      return {
        wave,
        categories: categoriesSorted,
        count: categoriesSorted.reduce((n, c) => n + c.riders.length, 0),
      };
    });
}
