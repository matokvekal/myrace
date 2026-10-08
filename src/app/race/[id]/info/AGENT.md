# Info Folder Guide

Purpose

- Race Info tab: race metadata, partial export, merge-import, info-field
  persistence, category export, and (for downloaded races) the lightweight
  "Remove downloaded race" action.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. Info.tsx
4. ExportCategoriesModal.tsx, MergeImportModal.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - Info.tsx (largest file — race metadata editing, export/import entry points,
    view-only/downloaded-race Danger-Zone-lite delete)
  - ExportCategoriesModal.tsx + (shares transferModal.module.css)
  - MergeImportModal.tsx + (shares transferModal.module.css)
  - info.module.css, transferModal.module.css

Conventions

- Full race export must go through Excel (xlsx) so another app instance can
  import and resume the race at the same state; only the clock rebases on
  import, everything else transfers verbatim (see project memory
  `project_excel_export.md`).
- xlsx handling is dynamic-imported (`import("xlsx")`) — never import it
  eagerly at module top level, it's excluded from the initial bundle on purpose
  (root CLAUDE.md "Bundle / code-splitting").
- `RaceProps.viewOnly` races get the light one-tap-trash delete here instead of
  the heavy Danger-Zone confirm (root CLAUDE.md "View-only (downloaded) races").

When To Update

- Export/import field coverage changes
- View-only/downloaded-race delete behavior changes
- Race metadata fields change
