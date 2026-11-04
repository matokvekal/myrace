# Cloud Folder Guide

Purpose

- UI for cloud-synced races: a section listing a user's cloud races
  (`CloudRacesSection`). (The per-race cloud panel was removed 2026-11-04 — it was
  never mounted.) Backed by `src/app/services/cloud/`. See
  `docs/cloud/0-START.md` before changing this folder.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. ../../../../../docs/cloud/0-START.md
5. ../../services/cloud/AGENT.md (the underlying sync/auth logic)

Immediate Children Summary

- No child folders.
- Top-level files:
  - CloudRacesSection.tsx (list of a user's cloud-synced races, rendered from
    `main/page.tsx`)
    invite/permission UI)
  - raceCloudPanel.module.css

Conventions

- The whole cloud tab is currently commented out of the UI (unreachable) per
  the session's test-plan scope notes — verify current wiring in `App.tsx`/
  `main/page.tsx` before assuming this is live.
- Cloud/Supabase SDK access must stay behind `isCloudConfigured()` (env-only
  check, no SDK import) so the bundle stays clean when cloud isn't configured
  (root CLAUDE.md "Bundle / code-splitting").

When To Update

- Cloud race list or per-race sync panel UI changes
- Role/permission UI changes (coordinate with `services/cloud/permissions.ts`)
