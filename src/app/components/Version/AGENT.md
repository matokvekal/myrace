# Version Folder Guide

Purpose

- App version display shown in the side-menu footer.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. Version.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - Version.tsx
  - version.module.css

Conventions

- Reads from `src/app/version.json` (`{ version, date }`), the single source of
  truth — `VITE_APP_VERSION` overrides at build time if set. Bump
  `version.json` before each release rather than editing this component (root
  CLAUDE.md "App version").

When To Update

- Version display format changes (not for routine version bumps — those go in
  `src/app/version.json`)
