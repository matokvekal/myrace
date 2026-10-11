# LoginError Folder Guide

Purpose

- `/loginerror` route: a simple full-screen error page shown when login fails,
  with a back-to-`/main` action.

Read Order

1. ../../../AGENT.md
2. ../AGENT.md
3. page.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - page.tsx (imports its CSS module twice — once as a bare side-effect import,
    once as `styles` — harmless but don't copy that pattern into new files)
  - error.module.css

Conventions

- Login is optional for core race operations — this page is only reachable
  from the (optional) login flow, never from the main race-management path.

When To Update

- Login-error UX or navigation-back target changes
