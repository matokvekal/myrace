# RaceTile Folder Guide

Purpose

- Compact race tile variant (status color/label, favorite toggle) used in a
  denser list layout than the full `RaceCard`.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. RaceTile.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - RaceTile.tsx (STATUS_COLOR/STATUS_LABEL maps: running="Live",
    upcoming="Soon", finished="Done")
  - raceTile.module.css

Conventions

- Keep `STATUS_COLOR`/`STATUS_LABEL` in sync with `RaceCard`'s equivalent
  status treatment if that file has its own copy — avoid the two drifting.

When To Update

- Status label/color mapping changes
- Tile layout/density changes
