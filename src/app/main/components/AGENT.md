# Main Components Folder Guide

Purpose

- The building blocks `main/page.tsx` actually assembles into the race-list
  home screen: header, empty state, race card/tile, and the download-a-race flow.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. headerMain/AGENT.md, raceCard/AGENT.md (most-used by page.tsx)
4. emptyRaces/AGENT.md, raceTile/AGENT.md, downloadRace/AGENT.md

Immediate Children Summary

- Folders:
  - downloadRace (DownloadRace.tsx — "Download a Race" flow; produces
    view-only/read-only races, see root CLAUDE.md "View-only (downloaded) races")
  - emptyRaces (EmptyRaces.tsx — empty-state shown when there are no races yet)
  - headerMain (HeaderMain.tsx — side-menu header: settings, joker-mode toggle,
    theme/language, version, clear-data)
  - raceCard (RaceCard.tsx — full race card, used in the main list)
  - raceTile (RaceTile.tsx — compact tile variant with status color/label,
    used in a denser list layout)
- No top-level files of its own — every child is a component subfolder.

Conventions

- `RaceCard`/`RaceTile` both key off `RaceProps.viewOnly` to render the
  lightweight one-tap-trash delete instead of the heavy Danger-Zone confirm for
  downloaded races.
- `HeaderMain` owns the `useJokerMode` checkbox (localStorage
  `commissaire.jokerEnabled`) — the single opt-in point for the heat page's
  joker feature (root CLAUDE.md "Joker button").

When To Update

- New main-page building block added
- View-only/downloaded-race card treatment changes
