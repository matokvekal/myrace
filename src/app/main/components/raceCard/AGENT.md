# RaceCard Folder Guide

Purpose

- Full race card used in the main race list (name, date, image, status,
  favorite toggle, rider count).

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. RaceCard.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - RaceCard.tsx
  - raceCard.module.css

Conventions

- For `RaceProps.viewOnly` races, renders the light one-tap-trash delete
  (tap -> "Remove?" -> tap again) instead of navigating into the heavy
  Danger-Zone confirm — wired via `main/page.tsx`'s `handleDeleteRace` (root
  CLAUDE.md "View-only (downloaded) races").
- Race cover image resolution goes through `resolveRaceImage()` — don't inline
  a separate fallback-image scheme here.

When To Update

- Card display fields or favorite-toggle behavior change
- View-only delete-confirm UX changes
