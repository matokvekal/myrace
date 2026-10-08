# Dictionary Management

## Overview
There are **two dictionary files** for different purposes:

1. **dictionary_csv.json** - Field keywords for detecting CSV column names
2. **dictionary_clubs.json** - Club name mappings and standardization

## File Locations
- **Field Keywords**: `public/data/dictionary_csv.json`
- **Club Dictionary**: `public/data/dictionary_clubs.json`
- **Loaded on**: App startup (automatic)
- **Storage**: Also synced to browser's IndexedDB for offline use

## File 1: dictionary_csv.json (Field Keywords)

Used for auto-detecting CSV column names. Maps keyword variations to field names.

```json
{
  "bib": ["bib", "bib number", "number", "মrespר", "მნიშვნელი"],
  "first_name": ["first name", "firstname", "שם פרטי"],
  "last_name": ["last name", "surname", "שם משפחה"],
  "club": ["club", "team", "מועדון", "קבוצה"],
  "category": ["category", "class", "קטגוריה"]
}
```

Simply add more keyword variations for each field. Case-insensitive matching.

---

## File 2: dictionary_clubs.json (Club Mappings)

Maps club name variations to standardized club names.

```json
{
  "clubs": [
    {
      "id": "club-001",
      "standardName": "Blue Club",
      "terms": ["מועדון כחול", "כחול", "Blue Club", "Blue", "BC"]
    }
  ]
}
```

### Field Descriptions
- **id**: Unique identifier (`club-001`, `club-002`, etc.)
- **standardName**: The standardized club name (what gets stored)
- **terms**: Array of all name variations that map to this club
  - Include Hebrew variations
  - Include English variations
  - Include abbreviations
  - All terms will match to the standardName

## How It Works

### During CSV Import

**Step 1: Column Detection**
1. User uploads CSV file
2. System reads the first row (headers)
3. Each header is matched against `dictionary_csv.json` keywords
4. System suggests which app field each column represents

**Step 2: Data Mapping**
1. User maps columns to fields (or accepts auto-detected mapping)
2. For "Club" field: system uses `dictionary_clubs.json` to standardize names
3. Example: CSV has "כחול", system looks it up, finds "Blue Club", stores "Blue Club"

### Adding Field Keywords

Edit `dictionary_csv.json`, add keywords for a field:

```json
{
  "bib": [
    "bib",
    "number",
    "rider number",
    "מספר",
    "מספר רוכב"
  ]
}
```

### Adding Club Variations

Edit `dictionary_clubs.json`, add a new club:

```json
{
  "id": "club-005",
  "standardName": "Fields Club",
  "terms": ["מועדון שדות", "שדות", "Fields Club", "Fields", "FC"]
}
```

All terms (Hebrew + English) will automatically match to "Fields Club".

### Updating Entries
1. Edit the JSON file directly
2. Hard refresh browser (Ctrl+Shift+R) to reload
3. Or use Club Dictionary Manager in the app UI

## In-App Management

### Adding/Editing via UI
1. Open CSV Import wizard
2. Go to "Mapping" step
3. Click "📖 Club Dictionary" button
4. Add/Edit entries in the modal

**Note**: Changes made in the UI are stored in browser's IndexedDB, not in this file.

## Future Migration to Database

### Phase 1 (Current)
- ✅ Manual JSON file
- ✅ Loaded on app startup
- ✅ Synced to browser storage

### Phase 2 (Planned)
- Load from database API instead of JSON file
- Admin panel for managing entries
- Sync across devices
- History tracking
- Role-based access control

## How to Export Current Data

To export the current state from the app to JSON for backup or database migration:

Use the browser console:
```javascript
import { exportClubDictionaryToJSON } from '/utils/dictionaryLoader.ts';
const json = exportClubDictionaryToJSON();
console.log(json);
// Copy and paste into a file
```

Or access the store directly:
```javascript
import useClubDictionaryStore from '@/stores/clubDictionaryStore';
const store = useClubDictionaryStore.getState();
const entries = store.getAllEntries();
console.log(entries);
```

## Tips

### For dictionary_csv.json (Field Keywords)
- Add variations that appear in your actual CSV files
- Include both Hebrew and English keywords
- Shorter keywords are better (more matches)
- Order doesn't matter - all variations are equal
- Example: Add "rider" if your CSV has that column header

### For dictionary_clubs.json (Club Names)
- **ID**: Use `club-001`, `club-002` or UUID format
- **Standard Name**: Use one clear name (what gets stored)
- **Terms array**: Mix Hebrew + English freely
  - First term is used as "primary" in the app
  - But all terms match equally
- Keep terms short when possible
- Include all spelling variations from your CSVs

### Best Practices
- Keep JSON valid (proper commas, quotes, brackets)
- Use UTF-8 encoding for Hebrew text
- Trim whitespace from terms
- Don't mix typos in terms - fix at source
- Use consistent capitalization for English
- Review actual CSV files before adding keywords

## Troubleshooting

### Dictionary not loading?
1. Check browser console for errors
2. Verify JSON syntax at https://jsonlint.com/
3. Check file is at `public/data/clubDictionary.json`
4. Hard refresh browser (Ctrl+Shift+R)

### Changes not appearing?
1. If edited JSON file: Hard refresh browser
2. If using UI: Changes are in browser storage, clear and reload if needed
3. Check browser's IndexedDB in DevTools

### Missing entries after import?
1. Check that hebrewName exactly matches CSV values (case-insensitive matching)
2. Add the exact text to alternateNames
3. Re-import after updating dictionary
