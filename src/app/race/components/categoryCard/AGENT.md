# CategoryCard Folder Guide

Purpose

- Summary card for a single category (name, color, status, rider count).

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. CategoryCard.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - CategoryCard.tsx
  - categoryCard.module.css

Conventions

- Category color is inline style data from `utils/colorAssignment.ts`, not a
  CSS class — never hardcode category colors in the module CSS (root CLAUDE.md
  "Category colours").

When To Update

- Card display fields change
- Category color source/format changes
