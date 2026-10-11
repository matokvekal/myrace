# AddRider Folder Guide

Purpose

- Add-a-rider form/modal, used from the Standing page and RaceMode's
  QuickAddRider flow to insert a single rider into a race mid-flow.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. AddRider.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - AddRider.tsx
  - addRider.module.css

Conventions

- New riders must get a `raceUuid` matching the active race and a `category`
  matching an existing category name (see root CLAUDE.md rider invariants).
- `bibNumber` and `standing` are distinct fields — don't default one from the
  other.

When To Update

- Required/optional field set for a manually-added rider changes
- Bib-uniqueness validation on add changes
