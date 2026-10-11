# Race Components Folder Guide

Purpose

- Shared UI building blocks used across the race tabs (schedule, categories,
  heat, standing, results) — distinct from `src/app/components/` which holds
  app-wide (not race-specific) shared UI.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. Component folder relevant to your change (see summary below)

Immediate Children Summary

- Folders:
  - addRider (AddRider.tsx — add-a-rider form/modal used from Standing/RaceMode)
  - buttons (ButtonStart/ButtonRunning/ButtonFinished — category/heat status
    action buttons)
  - categoryCard (CategoryCard.tsx — summary card for one category)
  - categoryManager (CategoryManager.tsx — category list/CRUD panel)
  - headerHeat (HeaderHeat.tsx — header bar for heat/wave-scoped pages)
  - headerRace (HeaderRace.tsx — header bar for the race workspace)
  - heatCard (HeatCard.tsx — one heat's summary card, used by `[id]/heats/Heats.tsx`)
  - modals (CategoryModal, CategorySettingsModal, StatusModal — shared modal set)
  - raceInfo (RaceInfo.tsx — compact race metadata display block)
  - racePhaseSwitcher (RacePhaseSwitcher.tsx — switches setup/race-mode phase)
  - riderCard (RiderCard.tsx — rider summary card)
  - riderDetailModal (RiderDetailModal.tsx — full rider detail popup)
  - riderFlag (RiderFlag.tsx — country-flag `<img>`, BASE_URL-safe, fails silent)
  - standingCard (StandingCard.tsx — rider row for the standing/leaderboard page)
- No top-level files of its own — every child is a component subfolder.

Conventions

- Keep components focused and props-driven; pair `.tsx` changes with their
  `.module.css` sibling.
- `RiderFlag` renders nothing on a missing/404 flag instead of broken-image alt
  text — follow that same "degrade to nothing" pattern for any other asset-backed
  component added here (root CLAUDE.md "Static assets must go through BASE_URL").
- Status buttons (in `modals/StatusModal.tsx` and elsewhere) are ordered
  DNF -> DSQ -> DNS.

When To Update

- New shared race-tab component added or removed
- Cross-race-tab UI convention changes (card layout, modal patterns)
