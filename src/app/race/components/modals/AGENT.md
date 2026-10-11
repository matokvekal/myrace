# Modals Folder Guide

Purpose

- Shared modal set used across the race tabs: category create/edit, category
  settings, and rider status (DNF/DSQ/DNS).

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. CategoryModal.tsx, CategorySettingsModal.tsx, StatusModal.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - CategoryModal.tsx + categoryModal.module.css (create/edit a category)
  - CategorySettingsModal.tsx + categorySettingsModal.module.css (per-category
    settings: laps, color, auto-color opt-out)
  - StatusModal.tsx + statusModal.module.css (set rider status)

Conventions

- `StatusModal` buttons are ordered DNF -> DSQ -> DNS (out-statuses before
  internal ones) — this ordering must match `RiderLiveModal` on the heat page.
- `CategorySettingsModal` laps edits must flow through
  `updateCategoryAndSyncRiders()`, never `updateCategory()` directly.

When To Update

- Any modal's field set or validation changes
- Status-button ordering convention changes (update both this and RiderLiveModal)
