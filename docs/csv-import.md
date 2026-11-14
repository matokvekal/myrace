# CSV Import System

## Overview
4-step wizard for importing rider data from CSV/Excel files with intelligent column detection and validation.

## Component Flow

```
CSVImportWizard (main orchestrator)
├── UploadStep (step 1)
│   ├── File upload (drag & drop)
│   ├── Template selection
│   └── Scan Start List → ImageCapture (photo OCR, see docs/local-ocr.md): hidden, no entry point in the UI
├── ColumnMappingStep (step 2)
│   ├── Auto-detect columns using dictionary_csv.json
│   ├── Two lists: Imported on top (red X removes), Not imported below (red names; + opens the field picker)
│   ├── A field feeds from one column: picking it frees the previous one ("Keep as info" is multi-use)
│   ├── Birth date, UCI ID and bib colours are never auto-selected (OPT_IN_FIELDS); national ID / passport can't be imported at all
│   ├── Chevron on every row: filled count, examples, and Required / Unique rules when imported
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

## Phase 2 — Smart Rider Import (2026-11-14)

### Duplicate bibs (resolved before anything is saved)
- `utils/bibConflicts.ts` (pure): `findBibConflicts` / `proposeFreeBib` / `validateBibChoices` /
  `bibCorrectionsFrom`. Bibs are unique race-wide (every wave, every status — the engine counts all).
  Proposal 21 → 1021 → 2021…, 189 → 1189 → 2189…; 4+ digits step by the next power of ten. A
  candidate avoids existing bibs, every bib of the batch and earlier proposals. An existing rider
  keeps its bib; in the file the first row keeps it.
- Wizard: step `bibs` (`BibConflictStep`) between Preview and Import, only when needed. Every number
  is editable; Confirm is disabled until all bibs are unique; Back cancels (nothing saved).
- Create Race: the same resolver in the start-list preview (`preview.bibConflicts`); "Looks right"
  is disabled until resolved; `saveRace(..., bibCorrections)` applies them by rider index and REFUSES
  (race not kept) if the file now reads differently than in the preview.
- Audit: shared race → `RidersImported.bibCorrections` (engine: each must name a rider of the import
  carrying `correctedBib`); new race → `POST /races/publish {bibCorrections}` → RaceAdmin
  `bibsCorrectedAtImport`. `GET /races/:uuid/history?scope=checkin` lists both (original, corrected,
  reason, author, time) — shown in Check-In changes (any day) and Rider Details (`ImportBibNote`).
  Local races: device audit log (`logImportBibCorrections`).
- Start stays blocked on any duplicate (`bibIssues.ts`, unchanged).

### Loading feedback
- `ImportStages`: Reading → Mapping → Validating → Resolving duplicates → Saving. The bar is a real
  percentage only when countable (split by day); otherwise indeterminate. `busyRef` blocks double
  submits. A refused import offers "Back to preview" (file + mapping kept).
- Slowness root causes fixed: mapping memory read once per import (was headers × memories IDB
  round trips); Create Race writes riders in one transaction (was one per rider, then again);
  Preview issues indexed by row.

### Shared column-mapping dictionary (migration 015)
- `src/shared/import/columnMapping.ts`: `normalizeHeader`, `isIdentityHeader`, `resolveHeaderVotes`.
- `column_mappings` (header, userId, field, timesConfirmed, createdAt, lastConfirmedAt);
  `GET/POST /api/v1/me/column-mappings` (counts only, never who; identity headers refused).
- My confirmed mapping = confidence 100 for me. Others' = suggestion only when ≥ 2 agree (contested:
  3× majority), confidence 70 so a built-in match wins, and Continue is blocked until confirmed (✓).
  Contested headers suggest nothing (flagged). Wizard only — Create Race keeps local-only mapping so
  preview and save read the file identically.
- Mapping changes are no longer saved silently: Continue asks "Remember these mappings?".
