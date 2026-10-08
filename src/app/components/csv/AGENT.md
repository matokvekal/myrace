# CSV Folder Guide

Purpose

- The 4-step CSV/xlsx import wizard (upload -> mapping -> preview -> import)
  plus the club dictionary manager. See `docs/csv-import.md` and
  `docs/club-dictionary.md` for the full flow before changing this folder.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. ../../../../../docs/csv-import.md (component flow doc)
4. CSVImportWizard.tsx (orchestrator)
5. UploadStep.tsx -> ColumnMappingStep.tsx -> PreviewStep.tsx -> ImportProgressStep.tsx
6. ClubDictionaryManager.tsx, MultiDayDialog.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - CSVImportWizard.tsx (step orchestrator/state)
  - UploadStep.tsx (file pick; handles both .csv and .xlsx via `parseXLSXFile`)
  - ColumnMappingStep.tsx (largest step — auto-map + manual override +
    "Keep as info" synthetic target)
  - PreviewStep.tsx (row preview, RTL-aware for Hebrew)
  - ImportProgressStep.tsx (final import progress/summary)
  - ClubDictionaryManager.tsx (manages `public/data/dictionary_clubs.json`
    mappings, multi-term Hebrew + English)
  - MultiDayDialog.tsx (handles multi-day start lists)

Conventions

- Shares `rowToRider` / `autoMapColumns` with the other two import entry points
  (Create-Race's `saveRace`/`insertRidersCsv`, and `race/[id]/editRiders`) —
  keep mapping logic in `services/csvMapper.ts`, don't fork it here.
- Unrecognized columns can map to the synthetic "Keep as info" target, stored
  per-column in `rider.extraFields[<original header>]` — never silently drop
  an unmapped column (root CLAUDE.md "Import: Keep as info columns").
- Ambiguous headers (`מס'`, `No.`, `#`) are capped at confidence 75
  (`AMBIGUOUS_ALIAS_CAP` in `types/csv.types.ts`) so a specific header always
  wins; `subCategory` keywords are absorbed on purpose to avoid overwriting the
  real category field (root CLAUDE.md "Bib vs Standing", "Categories are flat").
- xlsx parsing (`parseXLSXFile`) is dynamic-imported — never import `xlsx`
  eagerly (root CLAUDE.md "Bundle / code-splitting").

When To Update

- Any wizard step's UI or validation changes
- Column-mapping/confidence-scoring rules change
- Club dictionary format changes
