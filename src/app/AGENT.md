# App Folder Guide

Purpose

- Core product modules: race workflows, stores, import, UI, legal, and utilities.

Read Order

1. ../../AGENT.md
2. ../AGENT.md
3. stores/AGENT.md
4. race/AGENT.md
5. Feature folder AGENT.md for your task area

Subfolder Map

- components/: reusable UI and workflow widgets
- race/: race tabs, heat flows, standings, results
- stores/: Zustand + persistence orchestration
- types/: shared contracts
- utils/: timing/ranking/helpers
- services/: mapping/import/storage service logic

Immediate Children Summary

- Folders:
  - assets (images/icons/static app assets)
  - components (shared UI and feature UI blocks)
  - config (config and env-facing values)
  - constants (shared constant definitions)
  - contact (contact route)
  - hooks (reusable React hooks)
  - landingV2 (landing experience variant)
  - legal (legal text source and acceptance logic)
  - login (login route)
  - loginerror (login error route)
  - main (main race list/workspace)
  - otp (OTP verification route)
  - race (race runtime flows)
  - services (domain services)
  - stores (Zustand stores + persistence adapters)
  - styles (shared style assets)
  - terms (terms route)
  - types (domain and CSV type contracts)
  - utils (timing/ranking/shared helpers)
  - workers (web workers)
- Top-level files:
  - globals.css (global styles)
  - layout.tsx (app layout wrapper)
  - page.tsx + page.module.css (root app page)
  - not-found.tsx + not-found.css (404 route)
  - landing.module.css (landing styling)
  - version.json (app version metadata)

Working Rules

- Preserve offline-first behavior.
- Respect raceUuid/category/heat invariants.
- For timing/lap logic, verify behavior against known bugs and tests.
