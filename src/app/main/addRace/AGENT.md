# AddRace Folder Guide

Purpose

- New-race creation form: metadata (name/date/location), cover image (with
  random fallback + compression), optional start-list CSV/xlsx upload, saves
  via `saveRace()`/`insertRidersCsv()`.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. AddRace.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - AddRace.tsx
  - addRace.module.css

Conventions

- Auto-color is on by default for new races (`race.autoColor === false` opts
  out; `undefined` counts as true) — see root CLAUDE.md "Category colours".
- Both `.xlsx` and `.csv` start-list uploads are supported here: xlsx goes
  through `parseXLSXFile`, csv through `file.text()` + Papa — never
  `file.text()` an xlsx file, it's binary (root CLAUDE.md "Start-list import
  paths").
- Cover image is compressed via `compressImage()` before storage.

When To Update

- New-race required/optional field set changes
- Start-list upload handling changes (xlsx vs csv branching)
- Cover-image fallback list or compression behavior changes
