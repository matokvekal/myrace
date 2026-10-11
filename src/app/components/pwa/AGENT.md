# PWA Folder Guide

Purpose

- Progressive Web App install/update awareness UI: install prompt and
  service-worker update prompt, plus their hooks.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. usePwaInstall.ts, InstallPrompt.tsx
4. useServiceWorkerUpdate.ts, UpdatePrompt.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - usePwaInstall.ts (wraps the `beforeinstallprompt` event)
  - InstallPrompt.tsx + installPrompt.module.css (UI offering to install)
  - useServiceWorkerUpdate.ts (detects a waiting/new service worker)
  - UpdatePrompt.tsx (UI offering to reload and pick up the update)

Conventions

- PWA install-prompt testing is explicitly out of scope for Playwright
  (`serviceWorkers: "block"` in `playwright.config.ts`) — don't expect this
  folder to have automated coverage.

When To Update

- Install/update prompt UX or trigger conditions change
