# DownloadRace Folder Guide

Purpose

- "Download a Race" flow: pulls in a read-only copy of a race for viewing
  results, setting `RaceProps.viewOnly = true` on the result.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. DownloadRace.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - DownloadRace.tsx
  - downloadRace.module.css

Conventions

- This is the ONLY place that should set `RaceProps.viewOnly = true` — keep
  that flag-setting centralized here (root CLAUDE.md "View-only (downloaded) races").
- Downloaded races get the light delete path (one-tap trash on `RaceCard`, plain
  "Remove downloaded race" in Info) instead of the heavy Danger-Zone confirm —
  don't reintroduce the heavy confirm for `viewOnly` races.

When To Update

- Download source/format changes
- view-only flag semantics change
