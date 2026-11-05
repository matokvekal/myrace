# RiderCard Folder Guide

Purpose

- General-purpose rider summary card (bib, name, category, status) reused
  across race tabs outside the live heat page.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. RiderCard.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - RiderCard.tsx
  - riderCard.module.css

Conventions

- Render country flag via `../riderFlag/RiderFlag.tsx`, never a raw
  `<img src="/international/...">` (BASE_URL requirement, root CLAUDE.md
  "Static assets must go through BASE_URL").

When To Update

- Card display fields change
- Status badge styling/ordering changes
