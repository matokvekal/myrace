# Map Folder Guide

Purpose

- Race-course map tab, rendering the route (backed by `public/tracks/route.json`)
  via a lazy-loaded Leaflet map.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. Map.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - Map.tsx
  - map.module.css

Conventions

- Leaflet is heavy and must stay lazy-loaded (`lazy(() => import("./map/Map"))`
  in App.tsx) — never import leaflet eagerly at module top level (root CLAUDE.md
  "Bundle / code-splitting").
- Shares the underlying map primitive with `src/app/components/map/RaceMap.tsx`
  — check that file before duplicating map logic here.

When To Update

- Route/track data source changes
- Map rendering library or lazy-load wiring changes
