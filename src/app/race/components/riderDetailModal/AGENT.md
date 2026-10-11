# RiderDetailModal Folder Guide

Purpose

- Full rider detail popup (all fields, extra/info fields, history) — the
  general-purpose counterpart to the heat page's `RiderLiveModal`.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. RiderDetailModal.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - RiderDetailModal.tsx
  - riderDetailModal.module.css

Conventions

- Displays `rider.extraFields[<original header>]` ("Keep as info" import
  columns) under a "More info" section — don't drop unrecognized fields when
  changing this modal's layout (root CLAUDE.md "Import: Keep as info columns").

When To Update

- Rider detail field set or "More info" rendering changes
