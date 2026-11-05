# Public Data Folder Guide

Purpose

- Import-time dictionaries and locale strings, served as static files and
  fetched at runtime (not bundled as ES modules) — field-keyword dictionary for
  CSV auto-mapping, plus its guide doc, plus the `locales/` subfolder.

Read Order

1. ../../AGENT.md
2. ../AGENT.md
3. dictionary_csv.json, DICTIONARY_GUIDE.md
4. locales/AGENT.md

Immediate Children Summary

- Folders:
  - locales (en.json / he.json UI strings + index.json manifest)
- Top-level files:
  - dictionary_csv.json (field-keyword dictionary for CSV column auto-mapping —
    see root CLAUDE.md and `docs/csv-import.md`)
  - DICTIONARY_GUIDE.md (explains this file plus `dictionary_clubs.json`, which
    despite being documented here is NOT currently present in this folder —
    verify before assuming it exists)

Conventions

- Loaded on app startup and synced to IndexedDB for offline use — treat this
  JSON as data the app depends on at runtime, not just documentation fixtures.
- Reference these files via `import.meta.env.BASE_URL`, never a hardcoded
  `/data/...` path (root CLAUDE.md "Static assets must go through BASE_URL").

When To Update

- New CSV field keyword added
- Club dictionary format/location changes
