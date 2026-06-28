# Rider Data Structure

## RiderProps Interface
**File:** `src/app/types/types.ts` (lines 86-119)

```typescript
interface RiderProps {
  // Identity
  id: number;
  bibNumber: number;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  
  // Race Info
  raceUuid: string;
  category: string;
  subCategory?: string | null;
  team: string | null;
  
  // Status & Results
  raceStatus: "finished" | "running" | "upcoming";
  status: "standing" | "running" | "finished" | "DNF" | "DSQ" | "DNS";
  heat: number;
  totalLaps: number;
  lapsCounter: number;
  lapsDetails: Array<{ lap: number; startTime: Date; endTime: Date; lapTime: string }>;
  
  // Timing
  timeStartRace: string | null;
  timeArrive: string | null;
  elapsedTimeFromStart: string | null;
  elapsedLastLap: string | null;
  
  // Positioning
  position_start: number | null;
  position_race: number;
  position_category: number;
  
  // Other Data
  points?: number | null;
  federation?: string | null;
  checked: boolean;
  distance: number | null;
  color: string | null;
  image: string | null;
  comment: string | null;
  chipNumber?: string;
  viewOrder: number;
}
```

## CSV Import Mapping

**Available fields from CSV:**
- bibNumber (required)
- firstName, middleName, lastName (or fullName)
- category
- team → standardized via club dictionary
- heat (numeric or text)
- gender
- totalLaps
- startTime → timeStartRace
- position → position_start
- points
- federation
- raceDay → for multi-day import splitting

**See:** `src/app/types/csv.types.ts` lines 35-49 (RiderFieldKey type)

## State Management

**Store:** `src/app/stores/ridersStore.ts`  
**Provider:** Zustand with IndexedDB persistence

**Key Methods:**
- `insertRiders(riders)` — Bulk upsert to IDB + Zustand
- `updateRider(rider)` — Single rider update, writes to IDB
- `updateAllRiders(riders)` — Batch update (merge by id); prefer over `updateRider` for sorted writes
- `getRiders(raceUuid)` — Load riders; returns from Zustand cache if `lastFetchedRaceUuid` matches
- `getRidersByHeat(raceUuid, heat)` — Synchronous selector (filter from Zustand)
- `getRidersByCategory(raceUuid, category)` — Synchronous selector (filter from Zustand)

## CSV Import Flow

1. Row parsed by `rowToRider()` function
2. Field values mapped based on ColumnMapping
3. Team field looked up in club dictionary
4. RiderProps object created with defaults
5. Inserted to store via `insertRiders()`
6. Categories rebuilt via `rebuildCategoriesFromRiders()`

## Important Notes

- Rider ID is timestamp + index (not UUID)
- Team lookup is case-insensitive match
- Full name auto-splits on space (first / rest)
- Middle name is optional (new field)
- Heat can be numeric or text (converted to number)
