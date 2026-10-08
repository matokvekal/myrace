# Categories Folder Guide

Purpose

- Category management tab: add/delete/protect categories, manual + auto color
  assignment, laps sync to riders, CSV-derived category creation.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. Categories.tsx
4. finishRider/AGENT.md, racingRider/AGENT.md (row components it renders)

Immediate Children Summary

- Folders:
  - finishRider (FinishRider.tsx — row/card for a rider already finished)
  - racingRider (RacingRider.tsx — row/card for a rider currently on course)
- Top-level files:
  - Categories.tsx (largest file here — category CRUD, color assignment,
    `updateCategoryAndSyncRiders()`)
  - categories.module.css

Conventions

- `updateCategoryAndSyncRiders()` in this file is the ONLY sanctioned way to
  change `category.laps` — never call `updateCategory()` directly for a laps
  change (see root CLAUDE.md "Laps: the category is the source of truth").
- `category.laps || rider.totalLaps` is the intentional resolution order: a
  category laps value of 0/null means "not set yet" and must not wipe laps that
  came from the start list.
- Categories are flat — one category per age band, no sub-categories authored
  going forward. `subCategory` still exists only for legacy races (see root
  CLAUDE.md "Categories are flat").
- Colors are assigned via `utils/colorAssignment.ts`, only after every category
  and start time is known — never while iterating categories one at a time.
  `race.autoColor === false` opts a race out of auto-coloring.

When To Update

- Category CRUD or protection-rule changes
- Color assignment algorithm or `CLOSE_START_MINUTES` changes
- Laps-sync behavior changes
