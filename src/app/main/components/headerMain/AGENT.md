# HeaderMain Folder Guide

Purpose

- Side-menu header for the main page: settings, the Joker-mode opt-in
  checkbox, theme/language, app version display, clear-data, and other global
  side-menu actions.

Read Order

1. ../../../../../AGENT.md
2. ../AGENT.md
3. HeaderMain.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - HeaderMain.tsx (largest file in `main/components` — side-menu contents)
  - headerMain.module.css

Conventions

- Owns `useJokerMode` (localStorage `commissaire.jokerEnabled`, default off) —
  the single opt-in checkbox for the heat page's Joker feature. Off means the
  joker button/strip never render anywhere; don't add a second toggle for it
  elsewhere (root CLAUDE.md "Joker button (heat page)").
- Renders `components/Version/Version.tsx` for the app version footer, sourced
  from `src/app/version.json` — don't hardcode a version string here.
- Start-list template download (`public/start-list-template.xlsx`) is offered
  from this side menu via a BASE_URL `<a download>`.

When To Update

- Any new global side-menu setting/toggle
- Theme, language, or clear-data flow changes
