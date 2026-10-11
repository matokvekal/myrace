# MyRaces Folder Guide

Purpose

- Alternate race-list rendering that fetches its own races via `useRaceStore`
  rather than receiving them as props from `main/page.tsx` — check whether it's
  actually mounted anywhere before assuming it's on the active render path
  (similar caveat to `../allRaces/`).

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. MyRaces.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - MyRaces.tsx (self-fetches races, renders `main/components/raceCard/RaceCard`)
  - myRaces.module.css

Conventions

- Sorts races by `id` descending — note this differs from `main/page.tsx`'s
  own date/name/status sort cycle; keep that divergence in mind if unifying.

When To Update

- If this component is wired into an active route/tab, or removed as dead code
