# JokerCard Folder Guide

Purpose

- Single card in the heat page's "🃏 Unresolved" strip: shows a captured joker
  tap with a live ticking "time since tapped" clock, tap-to-resolve.

Read Order

1. ../../../../../../../AGENT.md
2. ../AGENT.md
3. JokerCard.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - JokerCard.tsx
  - jokerCard.module.css

Conventions

- Purely presentational/timer display — the actual resolve flow (bib entry,
  backdated `recordLap`) lives in `../JokerResolveModal.tsx`, not here.

When To Update

- Card layout or ticking-clock display changes
- Joker card interaction (tap-to-open-resolve) changes
