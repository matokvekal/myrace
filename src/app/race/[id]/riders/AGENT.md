# Riders Folder Guide

Purpose

- Full rider list/management tab for a race: search/filter, edit, bib
  uniqueness, category reassignment, delete.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. Riders.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - Riders.tsx (list, search/filter, edit/delete, category reassignment)
  - riders.module.css

Conventions

- `bibNumber` (plate identity) and `standing` (pre-race seeding order) are
  distinct fields — do not conflate them when editing or validating uniqueness
  (see root CLAUDE.md "Bib vs Standing").
- Category reassignment must keep `rider.category` matching an existing
  category name for the same race (`raceUuid` scoping).

When To Update

- Rider list filter/search/edit behavior changes
- Bib-uniqueness validation changes
- Category reassignment flow changes
