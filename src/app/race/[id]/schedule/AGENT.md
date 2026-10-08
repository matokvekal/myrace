# Schedule Folder Guide

Purpose

- Schedule builder: groups categories into waves/heats by start time, and hosts
  `effectiveTotalLaps()` / `withCategoryLaps()` — the canonical resolvers other
  features use to read a rider's real lap count (see root CLAUDE.md "Laps: the
  category is the source of truth").

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. Schedule.tsx (buildSchedule, wave grouping, effectiveTotalLaps/withCategoryLaps)

Immediate Children Summary

- No child folders.
- Top-level files:
  - Schedule.tsx (large — wave/time editing, category grouping, staggered-start
    handling, lap-count resolution helpers)
  - schedule.module.css

Conventions

- Any code that needs a rider's lap count must go through
  `effectiveTotalLaps()`/`withCategoryLaps()` from this file, never read
  `rider.totalLaps` directly.
- Any write to `category.laps` must go through `updateCategoryAndSyncRiders()`
  in `race/[id]/categories/Categories.tsx`, not this file, and not `updateCategory()`.

When To Update

- Wave/start-time grouping logic changes
- Lap-count resolution rules change
- Schedule editing (reorder, delete-protection, staggered-start recompute) changes
