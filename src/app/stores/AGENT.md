# Stores Folder Guide

Purpose

- Zustand stores and persistence adapters for races, riders, categories, and UI/app state.

Read Order

1. ../../../AGENT.md
2. ../AGENT.md
3. ridersStore.ts, categoryStore.ts, racesStore.ts
4. indexDb/indexedDbHelper.ts

Critical Invariants

- Keep raceUuid scoping strict across all entities.
- Avoid in-place mutation when deriving sorted/positioned data.
- IndexedDB is source of truth; memory cache should not diverge.

When To Update

- New fields on Race/Category/Rider models
- Persistence schema/version changes
- Any load/save/hydration behavior change
