# Arcade Folder Guide

Purpose

- Shared topbar for the "night-stage arcade" public-page design used by the
  landing/sign-up/contact screens (see project memory `project_arcade_pages.md`).

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. ArcadeTopbar.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - ArcadeTopbar.tsx
  - arcadeTopbar.module.css

Conventions

- Part of the arcade design system: `src/app/styles/arcade.css` for shared
  styles, Bungee font via `@fontsource` (offline, no CDN), palette derived from
  `public/logo.png`'s cube. Login is gated by a `LOGIN_ENABLED=false` flag —
  don't assume login is reachable from here.

When To Update

- Arcade topbar layout/branding changes
- Login-gate flag behavior changes
