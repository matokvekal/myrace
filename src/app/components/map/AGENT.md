# Map Folder Guide

Purpose

- Shared Leaflet-based race-course map primitive (`RaceMap.tsx`), consumed by
  `race/[id]/map/Map.tsx`.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. RaceMap.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - RaceMap.tsx
  - raceMap.module.css

Conventions

- Leaflet must stay lazy-loaded — this component is reached only via
  `lazy(() => import("./map/Map"))` in App.tsx, never imported eagerly (root
  CLAUDE.md "Bundle / code-splitting").
- Route data comes from `public/tracks/route.json`.

When To Update

- Map rendering/track-loading logic changes
- Lazy-load wiring changes
