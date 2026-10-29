# EditRiders Folder Guide

Purpose

- Quick CSV/TXT rider importer for making bulk edits to an existing race's
  riders (distinct from the 4-step wizard and from Create-Race's importer).

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. EditRiders.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - EditRiders.tsx
  - editRiders.module.css

Conventions

- This importer is CSV/TXT only (`accept=".csv,.txt"`), with its own `parseCSV`
  — it does NOT handle xlsx. The 4-step wizard (`components/csv/CSVImportWizard`)
  is the one that handles xlsx via `parseXLSXFile`.
- Shares `rowToRider` / `autoMapColumns` with the other two import entry points
  — keep column-mapping logic in sync across all three rather than forking it
  here (root CLAUDE.md "Start-list import paths").

When To Update

- Quick-import column mapping or parsing changes
- Any change to `rowToRider`/`autoMapColumns` shared logic
