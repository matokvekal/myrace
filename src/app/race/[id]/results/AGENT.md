# Results Folder Guide

Purpose

- Post-race Results tab: final standings per category/race with a persisted
  column picker (see root CLAUDE.md "Results column picker").

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. Results.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - Results.tsx (positions/status rows, Columns menu, CSV export)
  - results.module.css

Conventions

- Column visibility choice persists in localStorage (`resultsVisibleFields`);
  Bib/Laps/Time/Status are toggleable, Place and Name always show.
- Rows are flexbox so hiding a column must reflow, not leave blank space.
- Read lap counts via `effectiveTotalLaps()`/`withCategoryLaps()` from
  `../schedule/Schedule.tsx`, never `rider.totalLaps` directly.

When To Update

- New exportable/toggleable column added
- Position/ranking display logic changes
- CSV export format changes
