# Src Folder Guide

Purpose

- Application source code entrypoint and route composition.

Read Order

1. ../AGENT.md
2. App.tsx (routing + lazy loading)
3. main.tsx (bootstrap)
4. app/AGENT.md

Architecture Notes

- React + Vite + React Router v6.
- Most feature logic lives in app/.
- Keep route-level code-splitting strategy intact.

When To Update

- Route additions/removals
- App bootstrap changes
- Global provider/lazy-loading strategy changes
