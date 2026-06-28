# Race Data Structure

## RaceProps Interface
**File:** `src/app/types/types.ts` (lines 19-48)

```typescript
interface RaceProps {
  // Identity
  id: number;
  uuid: string;
  raceId?: string;  // Formatted: YYYY-MM-DD-name
  
  // Basic Info
  name: string;
  owner: string;
  manager: string;
  date: string;
  time: string;
  
  // Details
  location: string;
  type: string;
  level: string;
  distance: number;
  
  // Contact & Rules
  orgenizer: string;  // sic - not corrected for compatibility
  phone: string;
  takanon: string;
  site: string;
  
  // Status & Config
  status?: "finished" | "running" | "upcoming";
  isActive: boolean;
  isFavorite?: boolean;
  heat: string;
  
  // Security
  isPrivate?: boolean;
  password?: string;
  
  // Sync
  createdAt: Date;
  lastUpdateAt: Date;
  syncedAt?: Date;
  serverVersion?: number;
}
```

## State Management

**Store:** `src/app/stores/racesStore.ts`  
**Provider:** Zustand with IndexedDB persistence

**Key Methods:**
- `insertRace(race)` - Create race
- `updateRace(race)` - Update race
- `getRaces()` - Get all races
- `deleteRace(uuid)` - Remove race

## Multi-Day Import

When CSV contains "raceDay" field:
1. System detects multiple day values
2. User chooses: split into separate races or import all together
3. If split: first day updates current race, other days create new races
4. Each race gets name suffix: `{originalName} - {dayValue}`

**File:** `CSVImportWizard.tsx` lines 228-308 (handleSplitByDay function)

## Categories

Linked via `raceUuid`. See `docs/category-data.md`.

Related type: `CategoryProps` in types.ts

## Important Notes

- UUID is crypto.randomUUID()
- ID is timestamp-based for sorting
- Heat stored as string (not number)
- Status auto-updated during race
- Privacy: optional password for private races
