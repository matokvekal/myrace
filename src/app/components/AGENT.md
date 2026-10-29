# Components Folder Guide

Purpose

- Shared and feature-specific UI components.

Read Order

1. ../../../AGENT.md
2. ../AGENT.md
3. Component folder relevant to your change

Immediate Children Summary

- Folders:
  - admin (admin tools)
  - arcade (arcade UI/experiments)
  - auth (authentication UI blocks)
  - circleChart (chart visualizations)
  - cloud (cloud sync/auth related components)
  - csv (CSV import wizard and mapping steps)
  - Footer (footer UI)
  - header (header controls)
  - headerLogo (logo/header branding)
  - importImage (OCR/photo import flow)
  - legal (legal text components)
  - map (map UI blocks)
  - otpbox (OTP input controls)
  - pwa (PWA install/awareness UI)
  - ui (shared UI primitives)
  - Version (version display)
  - voice (voice mode UI)
- Top-level files:
  - DictionaryInitializer.tsx (dictionary bootstrap)
  - Loader.tsx + loader.module.css (loading component)
  - MenuToggle.tsx (menu toggle control)
  - ViewModeToggle.tsx + viewModeToggle.module.css (view mode switch)

Conventions

- Keep components focused and props-driven.
- Pair component behavior changes with CSS module updates.
- Preserve mobile-first interactions and large tap targets in race operations UI.

When To Update

- New shared component patterns
- Cross-feature UI conventions
- Accessibility or dir=auto handling changes
