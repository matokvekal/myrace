# CategoryManager Folder Guide

Purpose

- Category list/CRUD panel component, used where categories need to be listed
  and edited outside the full Categories tab.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. CategoryManager.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - CategoryManager.tsx
  - categoryManager.module.css

Conventions

- Any laps change must go through `updateCategoryAndSyncRiders()` in
  `race/[id]/categories/Categories.tsx` — do not call `updateCategory()` here
  directly for a laps edit.

When To Update

- Category CRUD surface exposed by this panel changes
