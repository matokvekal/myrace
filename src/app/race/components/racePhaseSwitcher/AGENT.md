# RacePhaseSwitcher Folder Guide

Purpose

- Switches a race between setup mode and RaceMode (`isRaceMode` in
  `useUIStore`), surfaced from the race workspace header/tabs.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. RacePhaseSwitcher.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - RacePhaseSwitcher.tsx
  - racePhaseSwitcher.module.css

Conventions

- Drives `useUIStore`'s `isRaceMode`/`setRaceMode` — keep this the single entry
  point for that toggle rather than setting it ad hoc elsewhere.

When To Update

- Phase-switch conditions or confirmation UX change
