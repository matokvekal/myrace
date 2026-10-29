# Main Feature Guide

Purpose

- Race list/home workspace and primary navigation hub (route `/main`).

Read Order

1. ../../AGENT.md
2. ../AGENT.md
3. page.tsx (race list: search/sort/favorites, demo seed, rider counts)
4. addRace/AGENT.md and components/AGENT.md for the flows page.tsx composes

Immediate Children Summary

- Folders:
  - addRace (AddRace.tsx — new-race form: metadata, cover image, optional
    CSV/xlsx start-list upload, calls saveRace/insertRidersCsv)
  - allRaces (AllRaces.tsx — thin placeholder wrapper, not wired into page.tsx's
    "See All" flow which renders race cards directly)
  - myRaces (MyRaces.tsx — alternate/legacy race-list rendering, fetches its own
    races via useRaceStore rather than receiving them as props)
  - components (HeaderMain, EmptyRaces, RaceCard, RaceTile, DownloadRace — the
    actual building blocks page.tsx assembles; see components/AGENT.md)
- Top-level files:
  - page.tsx (MainPage — owns search/sort/favorites-filter state, loads races +
    per-race rider counts from IDB, demo-race seeding, renders HeaderMain +
    EmptyRaces or the race card/tile list + CloudRacesSection)
  - main.module.css (page-level layout/grid styles)

Focus Areas

- Create/open/delete race flows
- Entry points to import and race tabs
- View-only/downloaded race behavior (see DownloadRace in components/, and
  RaceProps.viewOnly handling described in the root CLAUDE.md)

When To Update

- Race-list sort/filter/search behavior changes
- New entry point added to/from the main page (e.g. another import path)
- Demo-race seeding or rider-count computation changes
