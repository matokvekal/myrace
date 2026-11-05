import type { CategoryProps } from "@/types/types";

/**
 * Finish Group learning — deterministic, no external service.
 *
 * The organizer's own past assignments are remembered as SETS of categories
 * they put in the same Finish Group (per race). In a new race, a remembered set
 * is suggested only when at least two of its categories are present. Nothing is
 * ever grouped because categories share a wave or because their names contain
 * "Men"/"Women": suggestions come only from groupings this organizer made.
 *
 * Categories are matched by a signature built from their structured parts —
 * level, gender and age range as they appear in the name, normalized — plus the
 * sub-category, so "Masters Men 40-49" ≡ "masters  men 40 - 49".
 */
export interface FinishGroupPrefs {
  version: 1;
  /** Per race: the category signature sets that shared a Finish Group. */
  races: Record<string, { at: string; groups: string[][] }>;
}

export const emptyPrefs = (): FinishGroupPrefs => ({ version: 1, races: {} });
const MAX_RACES = 50;

export function categorySignature(c: Pick<CategoryProps, "name" | "subCategory">): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/(\d+)\s*[-–]\s*(\d+)/g, "$1-$2") // age ranges: "40 - 49" → "40-49"
      .replace(/(\d+)\s*\+/g, "$1+")
      .replace(/[^\p{L}\p{N}+\- ]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const sub = c.subCategory ? ` | ${norm(c.subCategory)}` : "";
  return `${norm(c.name)}${sub}`;
}

/** The race's current Finish Groups (≥ 2 categories each) as signature sets. */
function groupsOf(categories: CategoryProps[]): string[][] {
  const byGroup = new Map<string, string[]>();
  for (const c of categories) {
    const g = c.linkGroup?.trim();
    if (!g) continue;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(categorySignature(c));
  }
  return [...byGroup.values()].filter((s) => s.length >= 2).map((s) => [...new Set(s)].sort());
}

/** Remember this race's assignments (replaces its earlier entry; keeps the 50 most recent races). */
export function learnRace(prefs: FinishGroupPrefs, raceUuid: string, categories: CategoryProps[], now = new Date()): FinishGroupPrefs {
  const races = { ...prefs.races, [raceUuid]: { at: now.toISOString(), groups: groupsOf(categories) } };
  const kept = Object.entries(races)
    .sort((a, b) => b[1].at.localeCompare(a[1].at))
    .slice(0, MAX_RACES);
  return { version: 1, races: Object.fromEntries(kept) };
}

/**
 * Suggested Finish Group values (category id → "1", "2", …) for categories
 * that have none yet, from the organizer's OTHER races. Most frequent sets
 * first; numbers continue after the race's own numeric groups.
 */
export function suggestFinishGroups(prefs: FinishGroupPrefs, raceUuid: string, categories: CategoryProps[]): Map<number, string> {
  const counts = new Map<string, { members: string[]; count: number }>();
  for (const [uuid, entry] of Object.entries(prefs.races)) {
    if (uuid === raceUuid) continue;
    for (const g of entry.groups) {
      const key = g.join("\u0001");
      const cur = counts.get(key) ?? { members: g, count: 0 };
      cur.count += 1;
      counts.set(key, cur);
    }
  }
  const learned = [...counts.values()].sort((a, b) => b.count - a.count || b.members.length - a.members.length);

  const used = new Set(categories.map((c) => c.linkGroup?.trim()).filter(Boolean) as string[]);
  let next = Math.max(0, ...[...used].filter((v) => /^\d+$/.test(v)).map(Number)) + 1;
  const out = new Map<number, string>();
  for (const set of learned) {
    const members = new Set(set.members);
    const match = categories.filter((c) => !c.linkGroup?.trim() && !out.has(c.id) && members.has(categorySignature(c)));
    if (match.length < 2) continue;
    while (used.has(String(next))) next += 1;
    const value = String(next++);
    for (const c of match) out.set(c.id, value);
  }
  return out;
}
