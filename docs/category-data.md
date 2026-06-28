# Category Data Structure

## CategoryProps Interface
**File:** `src/app/types/types.ts` (lines 61–76)

```typescript
interface CategoryProps {
  id: number;            // Date.now()-based (collision risk if creating fast — see app-review.md BUG-08)
  raceUuid: string;      // Links to parent race
  name: string;          // e.g. "גברים מאסטרס"
  subCategory?: string | null;  // e.g. "30-39", "40-49" — optional age/gender sub-group
  laps: number | null;          // Total laps for this category
  lapsCounter: number | 0;      // Not used on category level (used on riders)
  riders: number | null;        // Count of riders (display only)
  startTime: string | null;     // "HH:MM" format, null = TBD
  isConnected: boolean | null;  // Unused — kept for future socket use
  color: string | null;         // Hex color, assigned automatically or manually
  heat: number | null;          // Wave number (1, 2, 3 …) — 0 = unassigned
  status?: "finished" | "running" | "upcoming";
  linkedFinish?: boolean;       // If true, bell rings for all riders when leader finishes
  finishedAt?: number;          // epoch ms when category finished — used for LiveBoard sort order
}
```

## State Management

**Store:** `src/app/stores/categoryStore.ts`  
**Key Methods:**

| Method | Description |
|---|---|
| `getCategories(raceUuid)` | Load categories; returns from Zustand cache if available |
| `updateCategory(category)` | Upsert — finds by `id`, appends if not found |
| `createCategoriesFromRiders(raceUuid)` | Auto-derives categories from rider data |
| `rebuildCategoriesFromRiders(raceUuid)` | Delete all + re-derive from riders |
| `updateRiderColor(raceUuid, catName, subCat, color)` | Cascade color change to all matching riders |

## Category Templates

**Stored in:** `localStorage("categoryTemplates")`  
**Type:** `CategoryTemplate` interface (`types.ts` lines 79–86)

Predefined banks (hardcoded in `Categories.tsx` lines 14–63):
- Man/Woman Juniors — no sub-categories
- Man/Woman Masters — 5 age subs: 19-29, 30-39, 40-49, 50-59, 60+
- Man/Woman Elite — no sub-categories

## Auto-Creation from Riders

When categories are missing, `createCategoriesFromRiders` runs:

1. Reads all riders for the race
2. Groups by `"category::subCategory"` composite key
3. Assigns color from the COLORS rotation array
4. Creates `CategoryProps` with `laps` from rider's `totalLaps` (if consistent)
5. Links back to riders via `updateAllRiders` (sets `rider.color`)

## Heat / Wave Assignment

- `heat` field = wave number (integer)
- Assigned in Schedule editor or auto-grouped by `buildSchedule()` (schedule/Schedule.tsx)
- `buildSchedule` groups categories with `startTime` within 30 minutes of each other into the same wave
- Unassigned categories get `heat: 0`

## Important Notes

- Category `id` is `Date.now()` based — risk of collision if created within 1ms (BUG-08 in app-review.md)
- `startTime` is "HH:MM" string, not a Date object
- `lapsCounter` on CategoryProps is not incremented — lap counting happens on `RiderProps.lapsCounter`
- `finishedAt` is epoch ms, used only for sorting finished categories in LiveBoard (most recently finished = top)
- `linkedFinish: true` triggers the cascade bell in `heat/[heatId]/page.tsx` via `cascadeBellCats` set
