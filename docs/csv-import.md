# CSV Import System

## Overview
4-step wizard for importing rider data from CSV/Excel files with intelligent column detection and validation.

## Component Flow

```
CSVImportWizard (main orchestrator)
├── UploadStep (step 1)
│   ├── File upload (drag & drop)
│   ├── Template selection
│   └── Scan Start List → ImageCapture (photo OCR — see docs/local-ocr.md)
├── ColumnMappingStep (step 2)
│   ├── Auto-detect columns using dictionary_csv.json
│   ├── Manual mapping adjustment
│   ├── Club Dictionary Manager
│   └── Template save
├── PreviewStep (step 3)
│   ├── Data validation
│   ├── Error/warning display
│   └── Scroll through preview
└── ImportProgressStep (step 4)
    └── Show import results
```

## Files

**Main:**
- `src/app/components/csv/CSVImportWizard.tsx` - Orchestrator
- `src/app/components/csv/UploadStep.tsx` - File upload
- `src/app/components/csv/ColumnMappingStep.tsx` - Column detection & mapping
- `src/app/components/csv/PreviewStep.tsx` - Validation & preview
- `src/app/components/csv/ImportProgressStep.tsx` - Import progress

**Services:**
- `src/app/services/csvMapper.ts` - Column matching logic
- `src/app/services/templateStorage.ts` - Save/load templates

**Types:**
- `src/app/types/csv.types.ts` - All CSV-related types

**Alternate source (photo OCR):**
- `src/app/components/importImage/` - Offline OCR import module (see `docs/local-ocr.md`)

## Data Flow

1. **Upload** → File parsed → Headers detected
   - 1b. **Scan** (photo OCR) → photos → OCR → table reconstruction → enters the flow at step 2 with `detection: { encoding: 'OCR', delimiter: 'OCR', headerRow: 0 }`
2. **Mapping** → Columns matched against `dictionary_csv.json` → User confirms mapping
3. **Preview** → Data validated → Errors highlighted → User reviews
4. **Import** → Valid rows imported to Zustand stores → Categories rebuilt

## Key Functions

### rowToRider (CSVImportWizard.tsx)
Converts CSV row to RiderProps object. Handles:
- Field mapping
- Type conversion (parseInt, parseFloat)
- Club dictionary lookup (team field)
- Full name splitting
- Heat name-to-number mapping

### autoMapColumns (csvMapper.ts)
Auto-detects field types by:
1. Matching against `dictionary_csv.json` keywords
2. Fuzzy matching if no exact match
3. Assigning confidence scores

### validateData (PreviewStep.tsx)
Validates:
- Bib number required & unique
- First name required (warning if missing)
- Heat must be 1-99
- Laps must be 1-99

## Important Notes

- Club dictionary applied during import (rowToRider function)
- Multi-day imports create separate races for each day
- Error rows skipped during import (not deleted from CSV)
- Templates store column mappings for reuse
