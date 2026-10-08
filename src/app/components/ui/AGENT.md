# UI Folder Guide

Purpose

- Shared low-level UI primitives: the base `Button` and a generic
  `DeleteConfirmModal`, used throughout the app (this is the Danger-Zone-style
  heavy confirm referenced elsewhere for non-view-only deletes).

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. Button.tsx, DeleteConfirmModal.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - Button.tsx + button.module.css (variant: primary/success/secondary/icon/
    ghost; size: sm/md/lg; supports iconOnly, fullWidth, start/end icons)
  - DeleteConfirmModal.tsx + deleteConfirmModal.module.css (the heavy confirm
    dialog — `RaceProps.viewOnly` races use a lighter one-tap-trash instead,
    see `main/components/raceCard/` and `race/[id]/info/`)

Conventions

- This is the base primitive layer — feature folders should compose `Button`
  rather than hand-rolling buttons, to keep touch targets and variants
  consistent across race-operations UI.

When To Update

- New shared button variant/size added
- Delete-confirmation UX changes (non-view-only path)
